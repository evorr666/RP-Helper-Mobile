/**
 * Парсер кодексов (.txt) в структурированный массив статей.
 * Аналог FindBlocksInText из AHK-версии.
 */

export function parseCode(text, fileName) {
  const articles = [];
  let current = null;
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Новая статья: "Статья N", "Ст. N" или для ПДД "N.M"
    const isNew = /^\s*(Статья|Ст\.)\s*\d+/i.test(line)
      || (fileName === 'pdd.txt' && /^\s*\d+\.\d+/.test(line));

    if (isNew) {
      if (current) articles.push(current);
      current = {
        num: extractNum(line),
        title: line,
        text: line,
      };
    } else if (current) {
      current.text += '\n' + line;
    }
  }
  if (current) articles.push(current);

  return articles;
}

function extractNum(line) {
  let m = line.match(/(?:Статья|Ст\.)\s*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  m = line.match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

/**
 * Поиск по распарсенным статьям.
 * - Точное число → возвращает статью с этим номером.
 * - Иначе → подстрочный поиск по заголовку и тексту.
 */
export function searchArticles(articles, query) {
  const q = query.trim();
  if (!q) return [];

  // Поиск по номеру
  if (/^\d+(?:\.\d+)?$/.test(q)) {
    return articles.filter(a => a.num === q);
  }

  // Поиск по слову
  const ql = q.toLowerCase();
  return articles.filter(a =>
    a.title.toLowerCase().includes(ql) || a.text.toLowerCase().includes(ql)
  );
}

/**
 * Поиск статей по ключевым словам (для ИИ-ответов).
 * Возвращает до limit статей.
 */
export function findRelevant(articles, question, limit = 3) {
  const words = question.toLowerCase()
    .split(/[\s,.!?;:]+/)
    .filter(w => w.length >= 4);
  if (!words.length) return [];

  const scored = articles.map(a => {
    const text = a.text.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (a.title.toLowerCase().includes(w)) score += 3;
      if (text.includes(w)) score += 1;
    }
    return { article: a, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.article);
}