TRPG Archive - 最短導入手順

1. Supabaseでプロジェクトを作成する。
2. Supabase > SQL Editor で supabase/schema.sql を実行する。
3. Supabase > Project Settings > API から Project URL と anon / publishable key を取得する。
4. Auth > URL Configuration で Site URL / Redirect URLs にGitHub Pages URLを設定する。
5. config.js の supabaseUrl / supabaseAnonKey を自分の値に変更する。
6. GitHubにこのフォルダ内のファイルをリポジトリ直下へアップロードする。
7. Settings > Pages で main / root を指定してGitHub Pagesを有効にする。
8. 発行されたURLをPC版Chrome / Edgeで開き、新規登録・ログインする。
9. 「フォルダを選択」で 00_公式シナリオ ～ 05_企画 が入っている親フォルダを選択し、スキャンする。
10. スマホでも同じURLにログインして閲覧・編集する。

既存スプレッドシートはCSVに書き出して、一覧画面の「CSV取り込み」から読み込めます。

重要：config.js に service_role key / secret key を絶対に設定しないでください。anon / publishable key のみを使用します。
