export function escapeMarkdown(text: string) {
  return text.replace(/([\\`*_{}\[\]()#+.!|>~<\-])/g, '\\$1');
}

export function markdownPages(pages: string[]): string {
  if (!pages.some(page => page.trim())) throw new Error('No selectable text found. Scanned PDFs need OCR before exporting Markdown.');
  return pages.map((text, i) => {
    const paragraphs = text.trim().split(/\r?\n\s*\r?\n/).map(p => escapeMarkdown(p.replace(/\s+/g, ' ').trim())).filter(Boolean);
    return `## Page ${i + 1}\n\n${paragraphs.join('\n\n') || '*No selectable text on this page.*'}`;
  }).join('\n\n---\n\n') + '\n';
}
