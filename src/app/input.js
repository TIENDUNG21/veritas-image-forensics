/**
 * Ways a file gets in: the Open button, the drop zone (click, Enter/Space, drag and drop
 * anywhere on the page) and pasting an image from the clipboard.
 * @param {{
 *   dropzone: HTMLElement, openButton: HTMLElement, fileInput: HTMLInputElement,
 *   onFile: (file: File) => void
 * }} parts
 */
export function bindInput({ dropzone, openButton, fileInput, onFile }) {
  const choose = () => fileInput.click();
  openButton.addEventListener('click', choose);
  dropzone.addEventListener('click', choose);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) onFile(file);
    fileInput.value = '';
  });

  let depth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    depth++;
    dropzone.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropzone.classList.remove('dragging');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    dropzone.classList.remove('dragging');
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  });
  window.addEventListener('paste', (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) onFile(file);
  });
}
