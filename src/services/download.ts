import type { ExportFile } from "@/domain/export";

/**
 * Hand a generated file to the user.
 *
 * A blob URL and a synthetic click work in both the Tauri webview and a plain
 * browser, which keeps this one code path instead of two. The URL is revoked
 * afterwards: each one pins its blob in memory until it is, and a few exports
 * of a large document add up.
 */
export function downloadFile(file: ExportFile): void {
  const blob = new Blob([file.contents], {
    // The charset matters: without it a CSV of Turkish category names opens as
    // mojibake in Excel.
    type: `${file.mimeType};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // A frame later: revoking synchronously can cancel the download in some
  // engines before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
