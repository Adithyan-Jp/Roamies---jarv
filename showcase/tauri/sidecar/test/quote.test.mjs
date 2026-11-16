// Handoffs carry the user's exact words (quote.mjs): to a background agent, and back in the news. Run: npm test
import assert from 'node:assert/strict';
import { askedLine, exactWords, userWordsBlock, withWords } from '../quote.mjs';

// Verbatim, in curly quotes; only the ends are trimmed
assert.equal(exactWords('  make the logo bigger, and keep "Woof & Co" in caps  '), '“make the logo bigger, and keep "Woof & Co" in caps”');
assert.equal(exactWords(''), '');
assert.equal(exactWords(null), '');
// Too long: cut, and it says how much is missing
const long = 'a'.repeat(1600);
assert.match(exactWords(long), /^“a{1500}… \[100 more characters not shown\]”$/);
assert.equal(exactWords('x'.repeat(40), 10), '“xxxxxxxxxx… [30 more characters not shown]”');

// An agent's brief opens with their words and says whose win
const block = userWordsBlock('Ken', 'build a page for Woof Co in blue');
assert.match(block, /^Ken's exact words, quoted verbatim\./);
assert.match(block, /their words win/);
assert.match(block, /“build a page for Woof Co in blue”$/);
assert.equal(userWordsBlock('Ken', ''), '');

// Steering: their words ride along, unless the message already has them
assert.equal(withWords('Use blue', 'Ken', ''), 'Use blue');
assert.equal(withWords('Use blue', 'Ken', 'make it blue'), 'Use blue\n\nKen\'s exact words: “make it blue”');
assert.equal(withWords('Do "make it blue" now', 'Ken', 'make it blue'), 'Do "make it blue" now');

// What was asked, in a report line
assert.equal(askedLine('Ken', 'tidy my downloads'), 'Ken asked, in their words: “tidy my downloads”');
assert.equal(askedLine('Ken', ''), '');

console.log('quote tests: passed');
