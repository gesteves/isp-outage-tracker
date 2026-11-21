/** Saves `parts` as a file named `filename`, through a temporary link to a Blob URL. */
export function downloadFile(filename: string, parts: BlobPart[], type: string): void {
  const blob = new Blob(parts, { type });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking synchronously can cancel the download in some browsers, so wait a bit.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
