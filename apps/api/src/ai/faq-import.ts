export interface ParsedFaqItem {
  question: string;
  answer: string;
}

/**
 * 解析后台批量导入的问答文本，支持中英文标记：
 *
 *   Q: 如何重置密码？
 *   A: 在登录页点击「忘记密码」…
 *
 * 也支持「问题：」「答案：」；条目之间用空行分隔。
 */
export function parseFaqText(text: string): ParsedFaqItem[] {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/);
  const items: ParsedFaqItem[] = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    let question = '';
    let answer = '';
    let mode: 'question' | 'answer' | null = null;
    const flush = () => {
      if (question && answer) items.push({ question, answer });
      question = '';
      answer = '';
    };
    for (const line of lines) {
      const questionMatch = line.match(/^(?:Q|问|问题)\s*[:：]\s*(.*)$/i);
      const answerMatch = line.match(/^(?:A|答|答案)\s*[:：]\s*(.*)$/i);
      if (questionMatch) {
        if (question && answer) flush();
        question = questionMatch[1].trim();
        mode = 'question';
      } else if (answerMatch) {
        answer = answerMatch[1].trim();
        mode = 'answer';
      } else if (mode === 'question') {
        question += (question ? '\n' : '') + line;
      } else if (mode === 'answer') {
        answer += (answer ? '\n' : '') + line;
      }
    }
    flush();
  }
  return items.slice(0, 200);
}
