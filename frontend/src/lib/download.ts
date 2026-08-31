/**
 * Hand the browser a generated file.
 *
 * One place, because the revoke delay is a real gotcha and had already been
 * copy-pasted twice: Safari cancels the download if the object URL is revoked
 * in the same tick, so the URL has to outlive the click by about a second.
 * Revoking too early loses the file silently; never revoking leaks the blob for
 * the life of the document.
 *
 * It also keeps `screens/` free of setTimeout, which is a greppable rule and
 * only worth having if it has no exceptions.
 */
export function downloadFile(filename: string, contents: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
