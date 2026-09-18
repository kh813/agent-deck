use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::StatusCode,
    response::Response,
    routing::{get, post},
    Json, Router,
};
use axum_server::tls_rustls::RustlsConfig;
use futures_util::{SinkExt, StreamExt};
use image::ImageEncoder;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use crate::cert::resolve_active_tls_cert;
use crate::pty::{PtyPromptPayload, PtyState};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "type", content = "payload")]
pub enum WsServerEvent {
    #[serde(rename = "output")]
    Output(Vec<u8>),
    #[serde(rename = "prompt")]
    Prompt(PtyPromptPayload),
    #[serde(rename = "status")]
    Status(String),
    #[serde(rename = "pre_launch_output")]
    PreLaunchOutput(Vec<u8>),
    #[serde(rename = "pre_launch_status")]
    PreLaunchStatus(bool),
    #[serde(rename = "cwd_changed")]
    CwdChanged(String),
    #[serde(rename = "auth_ok")]
    AuthOk,
    #[serde(rename = "auth_error")]
    AuthError(String),
}

#[derive(Clone, Deserialize, Debug)]
#[serde(tag = "type", content = "payload")]
pub enum WsClientAction {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "write_pty")]
    WritePty { input: String },
    #[serde(rename = "resize_pty")]
    ResizePty { rows: u16, cols: u16 },
    #[serde(rename = "start_session")]
    StartSession {
        command: Option<String>,
        args: Option<Vec<String>>,
        cwd: Option<String>,
        rows: Option<u16>,
        cols: Option<u16>,
    },
    #[serde(rename = "stop_session")]
    StopSession,
    #[serde(rename = "respond_prompt")]
    RespondPrompt { input: String },
    #[serde(rename = "change_cwd")]
    ChangeCwd { cwd: String },
}

#[derive(Clone)]
pub struct WebServerHub {
    pub broadcast_tx: broadcast::Sender<WsServerEvent>,
    pub pty_state: PtyState,
    pub valid_tokens: Arc<RwLock<HashSet<String>>>,
    pub password: Arc<RwLock<String>>,
    pub is_running: Arc<RwLock<bool>>,
    pub port: Arc<RwLock<u16>>,
    pub shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
    pub current_cwd: Arc<RwLock<String>>,
    pub dist_dir: PathBuf,
}

impl WebServerHub {
    pub fn new(pty_state: PtyState, dist_dir: PathBuf) -> Self {
        let (broadcast_tx, _) = broadcast::channel(2048);
        Self {
            broadcast_tx,
            pty_state,
            valid_tokens: Arc::new(RwLock::new(HashSet::new())),
            password: Arc::new(RwLock::new(String::new())),
            is_running: Arc::new(RwLock::new(false)),
            port: Arc::new(RwLock::new(8443)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            current_cwd: Arc::new(RwLock::new(String::new())),
            dist_dir,
        }
    }

    pub fn broadcast(&self, event: WsServerEvent) {
        let _ = self.broadcast_tx.send(event);
    }

    pub async fn is_token_valid(&self, token: &str) -> bool {
        self.valid_tokens.read().await.contains(token)
    }

    pub async fn verify_and_create_token(&self, pass: &str) -> Result<String, String> {
        let current_pass = self.password.read().await.clone();
        if current_pass.is_empty() {
            return Err("Password is not configured on server.".to_string());
        }
        if pass == current_pass {
            let token = uuid::Uuid::new_v4().to_string();
            self.valid_tokens.write().await.insert(token.clone());
            Ok(token)
        } else {
            Err("Invalid password.".to_string())
        }
    }
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct WebServerStatus {
    pub running: bool,
    pub port: u16,
    pub local_ip: Option<String>,
    pub url: Option<String>,
    pub qr_code_base64: Option<String>,
    pub password_set: bool,
}

async fn handle_login(
    State(hub): State<WebServerHub>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, Json<ErrorResponse>)> {
    match hub.verify_and_create_token(&payload.password).await {
        Ok(token) => Ok(Json(LoginResponse { token })),
        Err(err) => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse { error: err }),
        )),
    }
}

async fn handle_ws_upgrade(
    ws: WebSocketUpgrade,
    State(hub): State<WebServerHub>,
) -> Response {
    ws.on_upgrade(move |socket| handle_ws_client(socket, hub))
}

async fn handle_ws_client(socket: WebSocket, hub: WebServerHub) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = hub.broadcast_tx.subscribe();

    let mut is_authenticated = false;

    // Task for forwarding broadcast events to client
    let mut send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&event) {
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Task for handling incoming client messages
    let hub_clone = hub.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(action) = serde_json::from_str::<WsClientAction>(&text) {
                    match action {
                        WsClientAction::Auth { token } => {
                            if hub_clone.is_token_valid(&token).await {
                                is_authenticated = true;
                                let _ = hub_clone.broadcast_tx.send(WsServerEvent::AuthOk);
                            } else {
                                let _ = hub_clone.broadcast_tx.send(WsServerEvent::AuthError("Unauthorized".to_string()));
                            }
                        }
                        _ => {
                            if !is_authenticated {
                                continue;
                            }
                            match action {
                                WsClientAction::WritePty { input } => {
                                    let _ = crate::pty::write_to_pty_internal(input, &hub_clone.pty_state).await;
                                }
                                WsClientAction::ResizePty { rows, cols } => {
                                    let _ = crate::pty::resize_pty_internal(rows, cols, &hub_clone.pty_state).await;
                                }
                                WsClientAction::RespondPrompt { input } => {
                                    let _ = crate::pty::write_to_pty_internal(input, &hub_clone.pty_state).await;
                                }
                                WsClientAction::StopSession => {
                                    let _ = crate::pty::stop_pty_internal(&hub_clone.pty_state).await;
                                    hub_clone.broadcast(WsServerEvent::Status("idle".to_string()));
                                }
                                WsClientAction::ChangeCwd { cwd } => {
                                    *hub_clone.current_cwd.write().await = cwd.clone();
                                    hub_clone.broadcast(WsServerEvent::CwdChanged(cwd));
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }
}

pub fn generate_qr_code_base64(url: &str) -> Option<String> {
    let code = QrCode::new(url.as_bytes()).ok()?;
    let image = code.render::<image::Luma<u8>>().build();
    let mut png_bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .ok()?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

pub async fn start_web_server_internal(
    hub: WebServerHub,
    port: u16,
    password: String,
    data_dir: PathBuf,
) -> Result<WebServerStatus, String> {
    if password.trim().is_empty() {
        return Err("Web UI requires a non-empty password for security.".to_string());
    }

    // Stop existing server if running
    stop_web_server_internal(&hub).await?;

    *hub.password.write().await = password;
    *hub.port.write().await = port;

    let cert_paths = resolve_active_tls_cert(&data_dir)?;
    let tls_config = RustlsConfig::from_pem_file(&cert_paths.cert_path, &cert_paths.key_path)
        .await
        .map_err(|e| format!("Failed to load TLS config: {}", e))?;

    let app = Router::new()
        .route("/api/login", post(handle_login))
        .route("/ws", get(handle_ws_upgrade))
        .nest_service("/", ServeDir::new(&hub.dist_dir).fallback(ServeDir::new(&hub.dist_dir)))
        .layer(CorsLayer::permissive())
        .with_state(hub.clone());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    *hub.shutdown_tx.lock().await = Some(shutdown_tx);
    *hub.is_running.write().await = true;

    let hub_bg = hub.clone();
    tokio::spawn(async move {
        let server = axum_server::bind_rustls(addr, tls_config)
            .serve(app.into_make_service());

        tokio::select! {
            res = server => {
                if let Err(e) = res {
                    eprintln!("Web server error: {}", e);
                }
            }
            _ = shutdown_rx.recv() => {
                // Server shutdown
            }
        }
        *hub_bg.is_running.write().await = false;
    });

    get_web_server_status_internal(&hub).await
}

pub async fn stop_web_server_internal(hub: &WebServerHub) -> Result<(), String> {
    let mut guard = hub.shutdown_tx.lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(()).await;
    }
    *hub.is_running.write().await = false;
    Ok(())
}

pub async fn get_web_server_status_internal(hub: &WebServerHub) -> Result<WebServerStatus, String> {
    let running = *hub.is_running.read().await;
    let port = *hub.port.read().await;
    let password_set = !hub.password.read().await.is_empty();

    let local_ip = local_ip_address::local_ip().ok().map(|ip| ip.to_string());
    let url = if running {
        local_ip.as_ref().map(|ip| format!("https://{}:{}", ip, port))
            .or_else(|| Some(format!("https://localhost:{}", port)))
    } else {
        None
    };

    let qr_code_base64 = url.as_ref().and_then(|u| generate_qr_code_base64(u));

    Ok(WebServerStatus {
        running,
        port,
        local_ip,
        url,
        qr_code_base64,
        password_set,
    })
}

// Tauri commands
#[tauri::command]
pub async fn start_web_server(
    port: u16,
    password: String,
    hub: tauri::State<'_, WebServerHub>,
    app: tauri::AppHandle,
) -> Result<WebServerStatus, String> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    start_web_server_internal(hub.inner().clone(), port, password, app_dir).await
}

#[tauri::command]
pub async fn stop_web_server(
    hub: tauri::State<'_, WebServerHub>,
) -> Result<(), String> {
    stop_web_server_internal(hub.inner()).await
}

#[tauri::command]
pub async fn get_web_server_status(
    hub: tauri::State<'_, WebServerHub>,
) -> Result<WebServerStatus, String> {
    get_web_server_status_internal(hub.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_password_required_for_web_server() {
        let pty_state = PtyState::default();
        let hub = WebServerHub::new(pty_state, PathBuf::from("dist"));
        let temp_dir = std::env::temp_dir();

        let result = start_web_server_internal(hub.clone(), 9443, "".to_string(), temp_dir.clone()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("requires a non-empty password"));

        let result_spaces = start_web_server_internal(hub.clone(), 9443, "   ".to_string(), temp_dir).await;
        assert!(result_spaces.is_err());
    }

    #[tokio::test]
    async fn test_auth_token_flow() {
        let pty_state = PtyState::default();
        let hub = WebServerHub::new(pty_state, PathBuf::from("dist"));
        *hub.password.write().await = "secret123".to_string();

        let wrong = hub.verify_and_create_token("wrong").await;
        assert!(wrong.is_err());

        let right = hub.verify_and_create_token("secret123").await;
        assert!(right.is_ok());
        let token = right.unwrap();

        assert!(hub.is_token_valid(&token).await);
        assert!(!hub.is_token_valid("invalid-token").await);
    }

    #[test]
    fn test_qr_code_generation() {
        let qr = generate_qr_code_base64("https://192.168.1.100:8443");
        assert!(qr.is_some());
        assert!(qr.unwrap().starts_with("data:image/png;base64,"));
    }
}
