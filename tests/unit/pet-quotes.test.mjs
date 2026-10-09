import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePetQuotes, selectPetQuote } from '../../src/runtime/pet-quotes.js';

test('语录支持中文和换行，保存时忽略空行、首尾空格与重复内容', () => {
 assert.deepEqual(normalizePetQuotes(['  保持好奇。\r\n\r\n', '慢慢来。\r下一步。', '保持好奇。', ' ']), ['保持好奇。', '慢慢来。', '下一步。']);
 assert.deepEqual(normalizePetQuotes([]), []);
 for (const input of [null, '语录', {}, [1], ['语录', null]]) assert.throws(() => normalizePetQuotes(input), /语录必须是文本列表/);
});

test('单条语录可重复展示，多条语录随机选择且不连续重复', () => {
 const quotes = ['第一条', '第二条', '第三条'];
 assert.equal(selectPetQuote([], '', () => 0), '');
 assert.equal(selectPetQuote(['唯一语录'], '唯一语录', () => 0), '唯一语录');
 assert.equal(selectPetQuote(quotes, '', () => 0), '第一条');
 assert.equal(selectPetQuote(quotes, '', () => .99), '第三条');
 assert.equal(selectPetQuote(quotes, '第二条', () => 0), '第一条');
 assert.equal(selectPetQuote(quotes, '第二条', () => .99), '第三条');
});
