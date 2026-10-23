# yobo-agent（例規ナビ 試行版）

甲賀広域行政組合消防本部の予防係向け、例規ナビの試行版（5人ほど・1か月）。

- `index.html`：claude.ai の本番のページに、`trial/trial_layer.js` の切り替え層を差し込んだもの（`trial/patch.py` で作る）。
- `config.json`：Claude を呼ぶ GAS の URL など。これがあるときだけ試行版として動く。
- データ（`index.json`・`search*.json`・`g/`・`gi/`・`ntc/`）：本番の公開ファイルの写し。
- `trial/Code.gs`：GAS のコード（Claude の中継と記録）。API キーはここには無く、GAS のスクリプト プロパティにだけ置く。
