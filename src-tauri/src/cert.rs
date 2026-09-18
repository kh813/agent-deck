use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, SanType};
use rustls_pki_types::{CertificateDer, PrivateKeyDer};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufReader;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

use crate::pty::resolve_project_root;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SslConfig {
    pub use_custom_ssl: bool,
    pub custom_cert_filename: Option<String>,
    pub custom_key_filename: Option<String>,
}

impl Default for SslConfig {
    fn default() -> Self {
        Self {
            use_custom_ssl: false,
            custom_cert_filename: None,
            custom_key_filename: None,
        }
    }
}

pub struct TlsCertPaths {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

pub fn get_config_dir() -> PathBuf {
    if let Ok(exe_path) = std::env::current_exe() {
        let root = resolve_project_root(exe_path);
        let config_dir = root.join("config");
        let _ = fs::create_dir_all(&config_dir);
        config_dir
    } else {
        let config_dir = PathBuf::from("config");
        let _ = fs::create_dir_all(&config_dir);
        config_dir
    }
}

pub fn load_ssl_config(config_dir: &Path) -> SslConfig {
    let config_file = config_dir.join("ssl_config.json");
    if config_file.exists() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(cfg) = serde_json::from_str::<SslConfig>(&content) {
                return cfg;
            }
        }
    }
    SslConfig::default()
}

pub fn save_ssl_config(config_dir: &Path, cfg: &SslConfig) -> Result<(), String> {
    let config_file = config_dir.join("ssl_config.json");
    let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_file, content).map_err(|e| format!("Failed to write ssl_config.json: {}", e))
}

pub fn get_or_create_self_signed_cert(data_dir: &Path) -> Result<TlsCertPaths, String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("Failed to create cert dir: {}", e))?;

    let cert_path = data_dir.join("cert.pem");
    let key_path = data_dir.join("key.pem");

    if cert_path.exists() && key_path.exists() {
        return Ok(TlsCertPaths {
            cert_path,
            key_path,
        });
    }

    let mut params = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "agent-deck Local Web UI");
    dn.push(DnType::OrganizationName, "agent-deck");
    params.distinguished_name = dn;

    // SAN (Subject Alternative Names)
    let mut sans = vec![
        SanType::DnsName("localhost".try_into().map_err(|e| format!("{:?}", e))?),
        SanType::IpAddress(IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))),
    ];

    if let Ok(local_ip) = local_ip_address::local_ip() {
        sans.push(SanType::IpAddress(local_ip));
    }

    params.subject_alt_names = sans;

    let key_pair = KeyPair::generate().map_err(|e| format!("Failed to generate keypair: {}", e))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to create self-signed certificate: {}", e))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    fs::write(&cert_path, cert_pem).map_err(|e| format!("Failed to write cert.pem: {}", e))?;
    fs::write(&key_path, key_pem).map_err(|e| format!("Failed to write key.pem: {}", e))?;

    Ok(TlsCertPaths {
        cert_path,
        key_path,
    })
}

// Validates whether the given cert_path and key_path contain valid PEM data for rustls
pub fn validate_tls_cert_and_key(cert_path: &Path, key_path: &Path) -> Result<(), String> {
    if !cert_path.exists() {
        return Err(format!("Certificate file does not exist: {:?}", cert_path));
    }
    if !key_path.exists() {
        return Err(format!("Private key file does not exist: {:?}", key_path));
    }

    // 1. Read & parse certificate(s)
    let cert_file = fs::File::open(cert_path)
        .map_err(|e| format!("Failed to open certificate file: {}", e))?;
    let mut cert_reader = BufReader::new(cert_file);
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut cert_reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to parse PEM certificates: {}", e))?;

    if certs.is_empty() {
        return Err("Certificate file contains no valid PEM certificates.".to_string());
    }

    // 2. Read & parse private key
    let key_file = fs::File::open(key_path)
        .map_err(|e| format!("Failed to open private key file: {}", e))?;
    let mut key_reader = BufReader::new(key_file);
    let key_opt: Option<PrivateKeyDer<'static>> = rustls_pemfile::private_key(&mut key_reader)
        .map_err(|e| format!("Failed to parse PEM private key: {}", e))?;

    if key_opt.is_none() {
        return Err("Private key file contains no valid RSA, PKCS8, or SEC1 private key.".to_string());
    }

    Ok(())
}

// Imports user-specified cert and key files: validates them, copies to config/ directory, and saves ssl_config.json
pub fn import_custom_ssl_cert(
    source_cert_path_str: &str,
    source_key_path_str: &str,
) -> Result<SslConfig, String> {
    let src_cert = Path::new(source_cert_path_str);
    let src_key = Path::new(source_key_path_str);

    // Validate first before copying
    validate_tls_cert_and_key(src_cert, src_key)?;

    let config_dir = get_config_dir();
    let dest_cert_path = config_dir.join("custom_cert.pem");
    let dest_key_path = config_dir.join("custom_key.pem");

    fs::copy(src_cert, &dest_cert_path)
        .map_err(|e| format!("Failed to copy certificate to config dir: {}", e))?;
    fs::copy(src_key, &dest_key_path)
        .map_err(|e| format!("Failed to copy private key to config dir: {}", e))?;

    let ssl_cfg = SslConfig {
        use_custom_ssl: true,
        custom_cert_filename: Some("custom_cert.pem".to_string()),
        custom_key_filename: Some("custom_key.pem".to_string()),
    };

    save_ssl_config(&config_dir, &ssl_cfg)?;

    Ok(ssl_cfg)
}

// Resolve active TLS cert paths: custom SSL if enabled and present/valid, otherwise fallback to self-signed
pub fn resolve_active_tls_cert(data_dir: &Path) -> Result<TlsCertPaths, String> {
    let config_dir = get_config_dir();
    let ssl_cfg = load_ssl_config(&config_dir);

    if ssl_cfg.use_custom_ssl {
        if let (Some(cert_name), Some(key_name)) = (ssl_cfg.custom_cert_filename, ssl_cfg.custom_key_filename) {
            let cert_path = config_dir.join(cert_name);
            let key_path = config_dir.join(key_name);
            if cert_path.exists() && key_path.exists() {
                if let Ok(()) = validate_tls_cert_and_key(&cert_path, &key_path) {
                    return Ok(TlsCertPaths {
                        cert_path,
                        key_path,
                    });
                }
            }
        }
    }

    get_or_create_self_signed_cert(data_dir)
}

// Tauri commands
#[tauri::command]
pub fn import_ssl_certificate(
    cert_path: String,
    key_path: String,
) -> Result<SslConfig, String> {
    import_custom_ssl_cert(&cert_path, &key_path)
}

#[tauri::command]
pub fn get_ssl_configuration() -> SslConfig {
    let config_dir = get_config_dir();
    load_ssl_config(&config_dir)
}

#[tauri::command]
pub fn reset_ssl_to_self_signed() -> Result<SslConfig, String> {
    let config_dir = get_config_dir();
    let mut cfg = load_ssl_config(&config_dir);
    cfg.use_custom_ssl = false;
    save_ssl_config(&config_dir, &cfg)?;
    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cert_generation_and_caching() {
        let temp_dir = std::env::temp_dir().join(format!("agent_deck_test_cert_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        
        let res = get_or_create_self_signed_cert(&temp_dir).unwrap();
        assert!(res.cert_path.exists());
        assert!(res.key_path.exists());

        let cert_content = fs::read_to_string(&res.cert_path).unwrap();
        assert!(cert_content.contains("BEGIN CERTIFICATE"));

        let key_content = fs::read_to_string(&res.key_path).unwrap();
        assert!(key_content.contains("BEGIN PRIVATE KEY"));

        // Validate the generated self-signed cert
        assert!(validate_tls_cert_and_key(&res.cert_path, &res.key_path).is_ok());

        // Second call should return existing files
        let res2 = get_or_create_self_signed_cert(&temp_dir).unwrap();
        assert_eq!(res.cert_path, res2.cert_path);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_validate_tls_invalid_cert() {
        let temp_dir = std::env::temp_dir().join(format!("agent_deck_test_invalid_cert_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        let dummy_cert = temp_dir.join("bad_cert.pem");
        let dummy_key = temp_dir.join("bad_key.pem");

        fs::write(&dummy_cert, "NOT A REAL PEM").unwrap();
        fs::write(&dummy_key, "NOT A REAL KEY").unwrap();

        let res = validate_tls_cert_and_key(&dummy_cert, &dummy_key);
        assert!(res.is_err());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
