export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 8000;

/** Read attachments locally. Only a bounded text excerpt is sent with the user's instruction. */
export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文档不能超过 10 MB。');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'txt') return (await file.text()).slice(0, MAX_DOCUMENT_CHARS);
  if (extension === 'docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.slice(0, MAX_DOCUMENT_CHARS);
  }
  if (extension === 'pdf') {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    try {
      let text = '';
      for (let index = 1; index <= pdf.numPages && text.length < MAX_DOCUMENT_CHARS; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
        page.cleanup();
      }
      return text.slice(0, MAX_DOCUMENT_CHARS);
    } finally { await pdf.destroy(); }
  }
  throw new Error('目前支持 .txt、.docx 和 .pdf 文档。');
}
