# Phyz Ops Vision
https://phyz-ops-vision-fczl.vercel.app

物流センター向けの社内改善Webアプリです。  
工程進捗の可視化、人員配置管理、アラート管理、CSV取込を一元化し、現場オペレーションの見える化と改善判断を支援します。

## 概要

Phyz Ops Vision は、物流センター運営で発生しやすい次の課題を解決することを目的に開発しました。

- 工程ごとの進捗状況が見えにくい
- 人員不足や配置の偏りに気づきにくい
- 遅延や異常を早く把握しにくい
- CSVベースの運用データを画面上で活用しづらい

このアプリでは、進捗・人員配置・アラートを横断的に確認でき、管理者が素早く状況判断しやすい構成を目指しています。

---

## 主な機能

### 1. ダッシュボード
- 総進捗率
- 遅延バッチ数
- 未対応アラート数
- 配置済み人数
- 不足人数合計
- 未対応アラート上位表示
- 遅延工程 TOP3
- 人員不足工程の強調表示
- 今日の更新履歴
- 対応完了率
- 各画面へのクリック遷移

### 2. 工程進捗一覧
- 工程進捗の一覧表示
- 日付フィルタ
- ステータス絞り込み
- キーワード検索
- 進捗率バー表示
- 進捗更新
- `progress_logs` 保存
- `work_batches` 更新
- 遅延・人員不足・SLAリスクの自動アラート作成

### 3. 人員配置ボード
- 工程別配置サマリー
- 目標人数 / 配置人数 / 不足人数の可視化
- スタッフ一覧
- 出勤状態表示
- 対応可能工程表示
- 応援候補表示
- 新規配置 / 配置変更 / 配置解除

### 4. アラート一覧
- アラート一覧表示
- ステータス絞り込み
- 重要度絞り込み
- キーワード検索
- 対応開始
- 対応完了
- 担当者設定
- 対応メモ保存

### 5. CSV取込
- staff CSV
- shift CSV
- batch CSV
- progress CSV
- CSVプレビュー
- 取込結果表示
- `import_jobs` 履歴保存

---

## 権限設計

本アプリは Supabase Auth と `profiles` テーブルを使い、ユーザーごとの権限を管理しています。

### 権限
- `admin`
  - すべての画面を閲覧可能
  - 更新系操作が可能
- `viewer`
  - 閲覧のみ可能
  - 更新系ボタンは非表示

### 新規登録時の挙動
- メールアドレス / パスワードで新規登録可能
- 新規登録時に `profiles` を自動作成
- 初期値
  - `role = viewer`
  - `approved = true`
  - `center_id = 川崎センター`

---

## 画面構成

- `/login`
- `/dashboard`
- `/progress`
- `/assignments`
- `/alerts`
- `/imports`

---

## 使用技術

### Frontend
- React
- Vite
- TypeScript
- Tailwind CSS
- React Router

### Backend / BaaS
- Supabase
  - Auth
  - Database
  - Row Level Security

### CSV処理
- PapaParse

---

## テーブル構成

主に以下のテーブルを利用しています。

- `centers`
- `profiles`
- `processes`
- `work_batches`
- `progress_logs`
- `staff`
- `staff_skills`
- `shifts`
- `work_assignments`
- `daily_process_targets`
- `alerts`
- `import_jobs`

---

## 開発のポイント

このアプリでは、実運用で起こりやすいテーブル差異や制約差異を考慮して実装しています。

例:
- `shifts` には `center_id` がない
- `work_batches` は `batch_code` ではなく `batch_no` ベースで扱う
- `progress_logs` は `note` ではなく `memo`
- `progress_logs.process_id` は `NOT NULL`
- `alerts.center_id` は `NOT NULL`
- `alerts.alert_type` は `NOT NULL`
- `alerts.status` は `resolved` ではなく `closed` が通る構成

そのため、更新処理や insert / update では、列差異に強い adaptive な実装を採用しています。

---

## セットアップ方法

### 1. リポジトリを取得
```bash
git clone https://github.com/yuruttoiyashi/PHYZ-OPS-VISION.git
cd PHYZ-OPS-VISION
