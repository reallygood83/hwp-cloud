---
name: hwp-cloud
description: HWP Cloud에서 한글(HWP·HWPX) 문서를 읽거나 고칠 때 먼저 읽는다. 문단 번호와 표 칸으로 읽고 hwpCloud.applyEdits로 고친다.
---

# HWP Cloud

Read this skill before reading or editing a 한글(HWP·HWPX) document on hwp-cloud.vercel.app.

The left editor is a canvas. Its text cannot be read and its toolbar buttons must not be clicked. Read and edit through the `hwpCloud` global (REPL / JavaScript) or, without JavaScript, the right-hand **Aside 도구** panel.

## Quick Reference

```js
hwpCloud.status();                       // { ready, hasDocument, title }
await hwpCloud.getText();                // "문단 1: …\n표 1 (3행 4열, 문단 2 안)\n1행 1열: …"
await hwpCloud.paragraphs();             // [{ no, text }] including empty paragraphs
await hwpCloud.tables();                 // [{ no, rows, cols, anchorNo, cells: [{ row, col, text }] }]
await hwpCloud.find('홍길동');            // [{ type: 'paragraph', no, text } | { type: 'cell', table, row, col, text }]

// Several edits in one call (preferred)
await hwpCloud.applyEdits([
  { op: 'replace', no: 2, text: '본문: 작품은 5편이다.', expect: '본문: 작품은 3편이다.' },
  { op: 'insertAfter', no: 1, text: '부제: 가을 신작' },
  { op: 'delete', no: 7, expect: '' },
  { op: 'cell', table: 1, row: 2, col: 3, text: '김영화', expect: '홍길동' },
]);

// Single edits
await hwpCloud.replaceParagraph(3, '새 문장');
await hwpCloud.insertAfterParagraph(3, '첫 줄\n둘째 줄');   // each line becomes a paragraph
await hwpCloud.deleteParagraph(3);
await hwpCloud.setCell(1, 2, 3, '내용');
await hwpCloud.replaceAll('2025년', '2026년');           // → count, includes table cells

// Documents and templates
await hwpCloud.newDocument();
await hwpCloud.listTemplates();
await hwpCloud.loadTemplate('보도자료');
await hwpCloud.saveAsTemplate('이름', '설명');   // ask the user first
await hwpCloud.download();                       // ask the user first; always .hwp
```

## Rules

- All numbers start at 1: paragraph `no`, table `no`, `row`, `col`.
- Numbers change after insert and delete. Read again with `getText()` before reusing a number. `applyEdits` is the exception: every `no` in one call refers to the document as it was when the call started.
- Pass `expect` with the text you read. If the document changed, `applyEdits` throws and edits nothing.
- `getText()` skips empty paragraphs but keeps their numbers, so numbers can jump (문단 3, 문단 5).
- Table text is not in `paragraphs()`. Use `tables()` or `find()`. `replaceAll` does change table cells.
- Keep the document's format: replace the text of existing paragraphs and cells instead of deleting and re-creating them.
- Every edit can be undone with Ctrl+Z in the editor.
- Ask the user before `download()`, `saveAsTemplate()`, or anything that discards the open document.
- Templates need Google sign-in. If `listTemplates()` fails, tell the user to click 구글로 로그인.

## Workflows

### Read a document
1. `hwpCloud.status()`. If `hasDocument` is false, ask the user to open a file or pick a template.
2. `await hwpCloud.getText()` for the whole document.
3. Use `find()` to locate a phrase before editing it.

### Fill a form (신청서·공문 양식)
1. `await hwpCloud.loadTemplate(name)` or have the user open the file.
2. `await hwpCloud.tables()`. A label cell (e.g. "성명") is usually followed by the value cell in the next column.
3. One `applyEdits` call with an `op: 'cell'` entry per value, each with `expect` set to the current cell text (often `''`).
4. `await hwpCloud.getText()` and report what changed.
5. Offer `download()`.

### Replace a phrase everywhere
1. `await hwpCloud.find(old)` and report how many places.
2. `await hwpCloud.replaceAll(old, new)`.
3. `await hwpCloud.find(old)` must return `[]`. If not, report the remaining places.

### Rewrite paragraphs (보도자료·공문 다듬기)
1. `await hwpCloud.paragraphs()`.
2. One `applyEdits` call with `op: 'replace'` entries and `expect` for each.
3. `await hwpCloud.getText()` and show the user the before/after of each paragraph.

## Without JavaScript

Use the **Aside 도구** panel: 문단 고치기 (번호 + 새 내용 + 문단 바꾸기 / 이 문단 뒤에 넣기 / 이 문단 삭제), 표 칸 고치기 (표 번호, 행, 열, 칸 내용), 찾아 바꾸기 (모두 바꾸기). The result sentence appears at the top of the panel. Click 문서 새로고침 if the list looks old.
