# 読書メモへの書き出し（設計）

2026-11-18

本を読んで AI にした質問を、ローカルの Obsidian ボルトへ Markdown として書き出す。
出てくるファイルは**読書メモそのものではなく、転記するための素材**であり、読者が
そこから抜粋して本番のノートへ移す。

## 決まっていること

| 問い                             | 答え                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| 何を書き出すか                   | その本でした質問と回答を全部（選別はしない）                       |
| 選別はどこで                     | Obsidian 側で手で。抜粋して本番ノートへ移す                        |
| 2 回目以降                       | 新しい質問だけ追記。転記して削った分は復活しない                   |
| どの端末で読んだぶんか           | 問わない（iPad・スマホ含む）。したがってデータ源はリモートの D1    |
| 引き金                           | `pnpm run notes:sync` を手で叩く                                   |
| 置き場                           | **新しい** Obsidian ボルト。既存のボルトには一切書かない           |
| ノートの作り                     | 既存の Kindle Highlights プラグインのノートに寄せる                |

## 全体の形

部品は 3 つ。

1. **`GET /api/pdf/:pdfId/export?since=<ISO>`** — その本の質問と回答を、引用した本文・
   ページ番号・id・時刻つきで JSON で返す
2. **Markdown に組む純粋関数**（`scripts/notes/`）— Obsidian の書式はボルトの事情なので
   サーバには入れない
3. **`scripts/sync-reading-notes.ts`** — ログイン → 本の一覧 → 各ファイルの frontmatter から
   どこまで書いたかを読む → `since` つきで取る → 追記

### 今日のコードでも取れる

`GET /pdf/:pdfId`（本 + ハイライト）・`GET /pdf/:pdfId/chats`（本そのものの会話）・
`GET /pdf/:pdfId/selections/:selId/chats`（ハイライトごと）が既にあるので、新しい口なしでも
組み立てられる。足すのは往復を減らすためと、書き出す形を zod で 1 箇所に固定するため
（ハイライト 50 個の本で 51 往復になる）。

## ボルト

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/
├── Obsidian/          ← 既存。触らない
├── conatus-vault/     ← 既存。触らない
└── reading/           ← 新規
    └── books/
        └── 達人プログラマー.md
```

**フォルダは `books/` だけ**。デイリーノートもテンプレートも作らない——続かなかったものを
持ち込まないのが新しいボルトにする理由であり、構造は本のファイルが溜まってから必要に
なったものだけ足す。

`.obsidian/` は作らない。Mac の Obsidian で「フォルダをボルトとして開く」を 1 回やったときに
向こうが作る。iPad 側は iCloud に現れたものを開くだけ。

## 素材ファイルの形

`books/<本の名前>.md`、1 冊 1 ファイル。

```markdown
---
book-chat:
  pdfId: 01KZ8XYZ...
  fileName: 達人プログラマー.pdf
  pageCount: 449
  lastExportedAt: '2026-11-18T09:12:03.411Z'
  questionsCount: 12
---
# 達人プログラマー

[リーダーで開く](https://chatbook.<サブドメイン>.workers.dev/books/01KZ8XYZ...)

## 質問

### 直交性と疎結合はどう違うんですか？

> 直交性とは、ある一つの変更が他に波及しないことを言う。

疎結合は……（回答そのまま）

— p.112 [開く](https://chatbook.../books/01KZ8XYZ...?page=112&selection=01KY4...) ^q-01ky4abc

---
```

- **質問は `###` の見出し**。Obsidian の `![[達人プログラマー#直交性と疎結合はどう違うんですか？]]`
  でセクションごと埋め込めるようにするため。60 字を超える質問は切って末尾に `…` を付ける
- **末尾のブロック ID は `^q-<質問の message id を小文字化>`**。回答 1 ブロックだけ引きたいときと、
  見出しが重複したときに確実に 1 問を指すため。見出しの重複を避ける処理は入れない
  （Obsidian は先頭のセクションを埋め込むだけで壊れないので、ブロック ID で足りる）
- **戻るリンクは `?page=` と `?selection=`**。`useReadingLocation` の URL 契約そのままなので、
  Obsidian から押せばその引用箇所に戻る。iPad からも同じリンクが効く
- **本そのものへの質問**は引用もページも無いので `— 本全体 [開く](...)` にする
- **回答が保存されなかった質問**（`CHAT_SAVE_FAILED`）も質問だけ写し、回答の代わりに
  「（回答は保存されていません）」と書く。聞いたことは残す

### ファイル名

`pdfs.fileName` から `.pdf` を落とし、ファイル名に使えない文字（`/` `:` など）を置換する。
題名を `fileName` とは別に持たせるのは、実際に見て不満が出てから。

## どこまで書き出したか

frontmatter の `lastExportedAt` ひとつ。**別の状態ファイルは持たない。**

- 本文を削っても frontmatter は残るので、転記して削った質問は復活しない
  （Kindle Highlights プラグインの `lastAnnotatedDate` と同じ設計）
- 値は**書き出した質問の `askedAt` の最大値**で、現在時刻ではない。クロックのずれで
  取りこぼさないため
- 何も書き出さなかったら触らない
- `questionsCount` は累積で足す（ファイルの中身を数えない。削られるので）
- **frontmatter が読めないファイルは触らず、報告して次の本へ行く**。読めないものを
  「まだ何も書いていない」と扱うと全件が重複して追記される

## サーバ側

### 形

`src/shared/schemas/export.ts`（front は使わないが、server とスクリプトが交わる形なので
shared に置く）。

```ts
exportedQuestionSchema = {
  questionId, question,
  answerId: nullable, answer: nullable,   // 保存に失敗した回答は null
  selectionId: nullable,                   // null は本そのものへの質問
  quote: nullable, pageNumber: nullable,
  askedAt,                                 // watermark はこれで進める
}
bookExportSchema = { pdfId, fileName, pageCount, questions: [...] }
```

### 置き場

| 何を                               | どこに                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| D1 を読む（`ResultAsync`）         | `src/server/services/pdfService.ts` の `readBookExport`       |
| 質問と回答を対にする（純粋関数）   | `src/server/services/bookExport.ts`                           |
| ルート                             | `src/server/routes/pdf.ts` の `GET /pdf/:pdfId/export`        |

`searchSelections`（service）と `bookSearch.ts`（純粋関数）と同じ分け方。無い本は
`serviceFailureResponse` が `PDF_NOT_FOUND` の 404 にする。

### 本 1 冊ぶんを全件読んで畳む

`since` で SQL を絞らない。**質問と回答は別の行**なので、`created_at > since` で切ると、
書き出しの合間に保存された回答が質問から切り離されて孤児になる。1 冊の会話は数十件なので、
全件を 1 クエリ（`chat_messages` に `selections` を LEFT JOIN。本の会話は `selection_id` が
null なので LEFT）で読み、純粋関数で対にしてから `askedAt > since` で絞る。`since` は
ペイロードを減らすだけで、DB の仕事は減らさない。

### 対にする規則

会話ごと（`selection_id` ごと）に `created_at, id` で並べ、`user` の行の次が `assistant`
ならそれが回答、違えば回答なし。

## スクリプト側

| 何を                             | どこに                           |
| -------------------------------- | -------------------------------- |
| Markdown に組む（純粋関数）      | `scripts/notes/renderNote.ts`    |
| frontmatter を読む・更新する     | `scripts/notes/frontmatter.ts`   |
| ファイル名を整える               | `scripts/notes/vaultPath.ts`     |
| ログイン・取得・読み書き         | `scripts/sync-reading-notes.ts`  |

`node scripts/sync-reading-notes.ts` を `pnpm run notes:sync` から叩く。TypeScript を
Node に直接食わせる形で、`e2e/fixtures/generateTestBook.ts` と同じ。ここから来る前提が 3 つある。

### Node 24 が要る

型の除去（type stripping）が無印で効くのは Node 23.6 以降。**この環境の既定の `node` は
v20.19.6** で、nvm に v24.19.0 が入っている。`notes:sync` を叩く前に PATH を通すこと。
`pnpm run notes:sync` が v20 で走ると構文エラーで落ちる（黙って動かないのではなく落ちるので、
気付けはする）。

### 相対 import には `.ts` を明示する

型の除去は拡張子を解決しない。`scripts/notes/` の中の相対 import は
`from "./renderNote.ts"` と書く（`generateTestBook.ts` が `"./testBookManifest.ts"` と
書いているのと同じ。`allowImportingTsExtensions` が両方の tsconfig で有効なので型側も通る）。

### `src/shared/` を import しない

**スクリプトは `src/` から何も読まない。** `src/shared/schemas/*.ts` どうしの import は
拡張子なし（`./citation`）で書かれているので、Node の型除去では解決できず落ちる。
`scripts/notes/` は自己完結させる。

その代償として、エンドポイントの応答の形とスクリプトの読み方がずれうる。zod スキーマは
サーバ側（`src/shared/schemas/export.ts`）がワイヤの形の正で、ずれは 2 つで受ける——
`test/worker/pdf.test.ts` が応答の形を固定し、スクリプトは欠けたフィールドを**本の名前つきで
throw** して黙って空のメモを書かない。

### 型チェックに入れる

**`scripts/` は今どの tsconfig にも入っていない**（`tsconfig.node.json` の `include` は
`vite.config.ts` / `drizzle.config.ts` / `vitest.workers.config.ts` の 3 つだけ）。
`scripts/tsconfig.json` を `e2e/tsconfig.json` と同じ形で作り（`tsconfig.node.json` を
extends、`include` は `./**/*.ts`）、ルートの `tsconfig.json` の `references` に足す。
足さないと `vp check` がここを見ないまま通る。

### 認証

公開 URL のリモート D1 を読むので、`POST /api/auth/login` でログインして Cookie を得る。

- 公開 URL とユーザー名は秘密ではないので環境変数（`CHATBOOK_URL` / `CHATBOOK_USER`）
- **パスワードは Keychain から**: `security find-generic-password -s chatbook -a <user> -w`
- `.dev.vars` は読まない（あれはローカル専用で、リモートの `AUTH_PASSWORD` とは別物）

## テスト

| 何を                                               | どこで                                      |
| -------------------------------------------------- | ------------------------------------------- |
| 質問と回答の対にする規則                           | `src/server/services/bookExport.test.ts`    |
| エンドポイント（404・`since`・他の本が混ざらない） | `test/worker/pdf.test.ts`                   |
| Markdown の形                                      | `scripts/notes/renderNote.test.ts`          |
| frontmatter の読み・更新・読めないとき             | `scripts/notes/frontmatter.test.ts`         |
| ファイル名の整え方                                 | `scripts/notes/vaultPath.test.ts`           |

`scripts/**` の `*.test.ts` は jsdom の vitest が拾う（`vite.config.ts` の `test` は `include` を
書かず、`node_modules` / `dist` / `test/worker` / `e2e` / エージェントの worktree を `exclude` する
だけなので、vitest の既定の `include` が `scripts/` も拾う）。**スクリプト本体（`sync-reading-notes.ts`）はテストしない**
——ファイルを書くだけに薄く保つ。

Markdown の形のテストは、`renderNote` が組んだ文字列を**完全一致**で照合する。見出し・
ブロック ID・リンクのどれが欠けても落ちるようにしないと、「動いていないのに通る」テストに
なる。

## 作らないもの

- **アプリ内の「メモに書き出す」ボタン**（File System Access API）— Safari / iOS が未実装なので
  iPad を捨てることになる
- **launchd での定期実行** — 手で叩く形が動いてから plist を足すだけなので後付けできる
- **選別の印**（D1 に列を足す）— 全部出して Obsidian で選ぶと決めた
- **双方向同期** — Obsidian で編集した内容をアプリに戻す道は作らない
- **題名を `fileName` と別に持つこと** — 使ってみて不満が出てから

## 既知の割り切り

- **iCloud の同期の競合**。iPad で開いたまま Mac から追記すると
  `ファイル名 (conflicted copy).md` ができることがある。追記は末尾に足すだけなので壊れ方は
  軽い。頻発するならボルトをローカルへ移す
- **frontmatter を消すと全件戻る**。本文を削るのは想定内だが、frontmatter は消さない
- **回答の html フェンスは Obsidian ではコードブロックのまま**（mermaid は描かれる）
- **読書位置やハイライトの色は書き出さない**。素材に要らない
