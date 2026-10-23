# 試行版のデータを本番に合わせる手順

試行版（このリポジトリ）のデータは、本番（claude.ai の元のページ https://claude.ai/artifact/3yStJzp1KyaoKCBHDqKpTh）のコピー。本番は毎週月曜（通知）と毎月1日（例規・国の法令）に自動で変わるが、試行版は自動では変わらない。荒木が「試行版のデータを最新にして」と頼んだとき、次の手順で合わせる。

## いつ
- 毎週月曜の取り込み（6:45）のあと、少なくとも 2026-10-26 と 2026-11-01 の月次更新のあと。

## 手順
1. リポジトリを用意する（Claude の `add_repo` で neetaro-creator/yobo-agent を push 権限つきで追加し、clone）。
2. 本番のファイル一覧を Artifact の `list`（scope "files"）で取り、リポジトリのファイル一覧・大きさと見比べる。違うものだけを、Artifact の `read`（`paths`）で取り出して、リポジトリの同じ場所に置く。本番に無くなったファイルはリポジトリからも消す。
   - 対象：`index.json`、`search.json`、`search_nat.json`、`g/`、`gi/`、`ntc/`（`k/`・`q/` を含む）。
   - 対象外：`tools/`、`copy/`、`index.html`（下の3.）。
3. 本番の `index.html` が変わっていたら（`read` で取り、このリポジトリの元の版と見比べる）、`python3 -I trial/patch.py <本番のindex.html> trial/trial_layer.js index.html` で試行版のページを作り直す。「置換元が 1 か所でない」で止まったら、本番の版が変わって切り替え層を差し込めない印。直さずに荒木へ報告する。
4. `config.json` は消さない・変えない（GAS の URL が入っている）。
5. 手元で確かめる：`python3 -m http.server` で配信し、ブラウザで開いて、上部の「例規集 内容現在」と画面下の通知の件数が本番と同じこと。
6. コミットして push する。通常の更新は差分だけなので、そのまま push してよい。月次更新で g/ のほとんどが変わったときは、履歴が太るので、`git checkout --orphan` で履歴を1つにまとめて強制 push する（先に荒木に一言伝える）。
7. 数分後に https://neetaro-creator.github.io/yobo-agent/ を開いて、同じ表示になっているか確かめる。

## 注意
- 本番のページ・tools・定期タスクには触れない。
- 記録のスプレッドシート（試行記録）にも触れない。
