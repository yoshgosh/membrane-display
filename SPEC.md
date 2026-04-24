# Membrane Display — 仕様書

## 概要

マウス（トラックパッド）の押下操作に連動して、押下地点を中心に画面が凹むような擬似触覚フィードバックを視覚的に提示する JavaScript ライブラリ。

- **幾何学的歪み**: SVG `feDisplacementMap` フィルターによる放射状のピクセル変位
- **光学的減光（影）**: Canvas オーバーレイによる放射グラデーション
- **非依存性**: HTML構造（テキスト・ボタン・入力欄）には一切干渉しない

---

## ファイル構成

```
membrane-display/
├── membrane.js   ライブラリ本体（MembraneEffect クラス）
├── index.html    テスト用ページ
└── SPEC.md       本仕様書
```

---

## 使い方

```html
<script src="membrane.js"></script>
<script>
  const effect = new MembraneEffect(options);
  effect.mount();

  // 後から解除する場合
  // effect.destroy();
</script>
```

### オプション

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `maxR` | `number` | `220` | 凹みエフェクトの半径（px） |
| `pressRate` | `number` | `0.015` | 押下アニメーションの速度係数 |
| `releaseRate` | `number` | `0.010` | 解放アニメーションの速度係数 |
| `shadowOpacity` | `number` | `0.40` | 影の最大不透明度（0〜1） |

---

## アーキテクチャ

### 2コンポーネント構成

```
[mousedown]
    │
    ├─ SVG feDisplacementMap ─→ <html> に filter: url() を適用
    │    幾何学的歪み
    │
    └─ Canvas オーバーレイ ─→ position:fixed, pointer-events:none
         光学的減光（影）
    │
[mouseup]
    └─ アニメーションで圧力を 0 に戻す → フィルター解除
```

### フィルター適用先が `<html>` である理由

`<body>` に CSS filter を適用すると、`<body>` 内の `position:fixed` 要素の基準座標系が body-relative に変わり、ヘッダーやモーダルなどの固定要素が画面外にずれる。`<html>` はビューポートと同サイズであるため、この問題が起きない。

---

## SVG フィルターパイプライン

```xml
<filter id="membrane-filter" filterUnits="userSpaceOnUse"
        x="0" y="0" width="W" height="H">

  <!-- 1. 中立グレー（R=G=128）でフィルター領域全体を埋める -->
  <feFlood flood-color="rgb(128,128,128)" result="neutral"/>

  <!-- 2. 変位マップ画像（押下位置に配置、押下座標が変わった時のみ更新） -->
  <feImage result="localMap" x="px-maxR" y="py-maxR"
           width="2*maxR" height="2*maxR"/>

  <!-- 3. 円外（透明）→ neutral(128)、円内 → 変位マップ値 を合成 -->
  <feComposite in="localMap" in2="neutral" operator="over" result="fullMap"/>

  <!-- 4. 変位を適用（scale = 0.35 * maxR * pressure、毎フレーム更新） -->
  <feDisplacementMap in="SourceGraphic" in2="fullMap"
                     scale="0"
                     xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

`feFlood` + `feComposite` が必要な理由: `feImage` の画像範囲外では値が `(0,0,0,0)` になり、R=0 は最大負変位（-scale/2 px）を意味するため、全画面が大きくずれてしまう。中立グレー (128) で埋めることで変位ゼロを保証する。

---

## 変位マップ生成アルゴリズム

オフスクリーン Canvas（`2*maxR × 2*maxR` px）にピクセルループで書き込む。

```
各ピクセル (x, y) について:
  dx = x - maxR,  dy = y - maxR
  r  = sqrt(dx² + dy²)

  r >= maxR のとき:
    → α = 0（透明）。feComposite により中立グレーが使われ変位なし。

  r < 0.5 のとき（中心 1px）:
    → R = G = 128, α = 255（変位なし）

  それ以外:
    σ = maxR × 0.35
    gaussVal = (r/σ) × exp(-r²/2σ²) × exp(0.5)   # ガウシアン微分、r=σ でピーク、正規化済み
    R = clamp(128 + 127 × (dx/r) × gaussVal, 0, 255)   # X 変位チャンネル
    G = clamp(128 + 127 × (dy/r) × gaussVal, 0, 255)   # Y 変位チャンネル
    α = 255
```

### feDisplacementMap の変位計算式

```
出力ピクセル (x, y) のサンプル元:
  src_x = x + scale × (R / 255 - 0.5)
  src_y = y + scale × (G / 255 - 0.5)
```

R > 128 → 右方向からサンプル、R < 128 → 左方向からサンプル。  
各ピクセルが「自分より外側の座標」からサンプルすることで、コンテンツが中心へ引き寄せられる凹み効果を生む。

### 圧力と scale の関係

```
scale = 0.35 × maxR × pressure
```

`pressure = 1.0`、`gaussVal = 1.0`（ピーク）、`dx/r = 1.0`（真横方向）のとき:
`src_x = x + scale × (255/255 - 0.5) = x + 0.175 × maxR`  
→ 最大 約 38px の変位が発生する（`maxR = 220` の場合）。

---

## アニメーション

### 圧力（pressure）モデル

```
pressure += (target - pressure) × (1 - exp(-rate × dt))
```

- `dt`: 前フレームからの経過時間（ms）。タブ切り替え後のスパイクを防ぐため 50ms にクランプ。
- `target`: mousedown → 1、mouseup → 0
- `pressure < 0.005` かつ `target = 0` になったら rAF を停止し、フィルターを解除する。

| 方向 | 係数 | 特性 |
|---|---|---|
| 押下 (`pressRate = 0.015`) | 約 150ms で 93% 到達 | 素早く応答 |
| 解放 (`releaseRate = 0.010`) | 約 300ms で 95% 到達 | ゆっくり戻る |

### dirty flag による最適化

変位マップ画像（`toDataURL`）はコストが高いため、押下座標が変化した時のみ再生成する。

| 操作 | 変位マップ | scale / feImage 位置 | 影 Canvas |
|---|---|---|---|
| mousedown | 再生成 | 更新 | 再描画 |
| mousemove（押下中） | 再生成（dirty） | 更新 | 再描画 |
| 毎フレーム（静止中） | スキップ | 更新のみ | 再描画 |

---

## 影（Canvas オーバーレイ）

```
r / maxR:  0.00  0.30  0.55  0.70  0.85  1.00
opacity:   0     10%   55%   100%  45%   0
           ↑中心  └──── 影が強くなる ────┘   ↑エッジ
```

全 opacity に `pressure` を掛けることで、押下強度に応じた自然な影の強さを実現。

中心には白の鏡面ハイライト（半径 `maxR × 0.22`、最大 opacity 10%）を重ねる。

---

## イベントハンドリング

| イベント | 対象 | 処理 |
|---|---|---|
| `mousedown` | `window` | 押下開始、rAF 起動 |
| `mouseup` | `window` | 解放（rAF は自然停止まで継続） |
| `mousemove` | `window` | 押下中のみ座標更新・dirty フラグ立て |
| `resize` | `window` | フィルター寸法・Canvas サイズを更新 |

`mouseup` を `window` レベルで監視することで、ブラウザ外へのドラッグアウトでも確実にリリースを検知できる。

---

## 座標系

| 変数 | 用途 | 由来 |
|---|---|---|
| `_pageX / _pageY` | SVG feImage の配置位置 | `MouseEvent.pageX/Y`（スクロール込み） |
| `_clientX / _clientY` | 影 Canvas の描画中心 | `MouseEvent.clientX/Y`（ビューポート相対） |

SVG フィルターの座標系は `filterUnits="userSpaceOnUse"` によりページ座標系、Canvas は固定オーバーレイなのでビューポート座標系を使う。

---

## パブリック API

### `new MembraneEffect(options?)`

インスタンスを生成する。DOM への副作用はない。

### `mount()`

SVGフィルター・Canvasオーバーレイを DOM に追加し、イベントリスナーを登録する。

### `destroy()`

rAF を停止し、DOM要素を除去し、イベントリスナーをすべて解除する。SPA での利用を想定。

---

## 制約事項

- SVG filter を `<html>` に適用するため、`<html>` 内の `position:fixed` 要素の containing block が `<html>` になる（通常はビューポートと同一なので実害は少ない）
- スクロール中に押下すると、`_pageY` ベースの feImage 位置と `_clientY` ベースの影 Canvas の中心がわずかにずれる場合がある
- `toDataURL('image/png')` は PNG エンコードを伴うため、`maxR` を極端に大きくすると mousemove 追従の遅延が生じる可能性がある
