// Images attached to the next message from the input bar's 🖼 button
// (app_specs.md 5.7.2). Two sources:
//  - "pasted": a screenshot from the clipboard, saved by the Rust side under
//    <agent-deck install>/tmp/screenshots/ (removed automatically after 7 days);
//  - "file": an image the user picked -- its own path is used as-is, nothing
//    is copied (and so nothing needs cleaning up).
// Send puts the quoted paths in front of the text, on one line (a newline
// would submit the prompt early in the CLI), e.g.
//   "/…/screenshot-20261126-101500.png" エラーの原因を教えて
import { promptTextForPaths, baseName } from "./imageAttach";

export type AttachmentKind = "pasted" | "file";

export interface Attachment {
  path: string;
  name: string;
  kind: AttachmentKind;
}

export const MAX_ATTACHMENTS = 10;

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "tif", "tiff"] as const;

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/** Adds new paths (skipping duplicates and blanks), up to MAX_ATTACHMENTS.
 *  Returns the new list and how many were dropped for the limit. */
export function addAttachments(
  current: readonly Attachment[],
  paths: readonly string[],
  kind: AttachmentKind,
): { list: Attachment[]; overLimit: number } {
  const list = [...current];
  let overLimit = 0;
  for (const raw of paths) {
    const path = raw.trim();
    if (!path || list.some((a) => a.path === path)) continue;
    if (list.length >= MAX_ATTACHMENTS) {
      overLimit++;
      continue;
    }
    list.push({ path, name: baseName(path), kind });
  }
  return { list, overLimit };
}

export function removeAttachment(current: readonly Attachment[], path: string): Attachment[] {
  return current.filter((a) => a.path !== path);
}

/** The single-line prompt Send types: quoted image paths, then the text. */
export function composeMessage(text: string, attachments: readonly Attachment[]): string {
  const oneLine = text.replace(/\r?\n/g, " ").trim();
  return (promptTextForPaths(attachments.map((a) => a.path)) + oneLine).trim();
}

/** Send is possible with text, images, or both. */
export function canSend(text: string, attachments: readonly Attachment[]): boolean {
  return text.trim().length > 0 || attachments.length > 0;
}
