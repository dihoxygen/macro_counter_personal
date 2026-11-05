/** Hands the person a file through the browser's own download. */
export function downloadFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Later, not now: the browser may not have started the download yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
