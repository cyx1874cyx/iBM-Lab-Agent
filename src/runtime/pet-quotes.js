export function normalizePetQuotes(values) {
 if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
  throw new Error('语录必须是文本列表');
 }
 return [...new Set(values.flatMap(value => value.split(/\r\n|\r|\n/)).map(value => value.trim()).filter(Boolean))];
}

export function selectPetQuote(quotes, previous = '', random = Math.random) {
 const choices = quotes.length > 1 ? quotes.filter(quote => quote !== previous) : quotes;
 return choices[Math.floor(random() * choices.length)] ?? '';
}
