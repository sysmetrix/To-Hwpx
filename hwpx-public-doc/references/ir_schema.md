# IR (구조화 단락) 스키마

입력을 HWPX 생성기가 처리할 수 있는 중간표현으로 정규화한 형식임. 모든 입력 포맷(Markdown·TXT·표)은 이 IR로 먼저 변환된 뒤 생성됨.

## 최상위 구조

```json
{
  "title": "문서 제목 (선택)",
  "doc_type": "official | report | plain",
  "blocks": [ ... ]
}
```

- `title`: 있으면 14pt 굵게로 문서 맨 앞에 배치됨. 없으면 생략.
- `doc_type`: 서식 스타일 결정.
  - `official` / `report`: 명사형 종결(~임. ~함. ~됨.)·가운뎃점(·) 적용
  - `plain`: 입력 그대로
- `blocks`: 본문 블록 배열. 순서대로 렌더됨.

## 블록 타입

### heading (소제목)
```json
{"type": "heading", "level": 1, "text": "1. 추진 배경"}
```
- `level` 1~2는 14pt 굵게, 3 이상은 본문 크기.

### para (본문 단락)
```json
{"type": "para", "text": "본문 내용임."}
```

인라인 서식이나 링크가 있으면 `runs`를 사용함.

```json
{
  "type": "para",
  "runs": [
    {"text": "공식 사이트", "bold": false, "italic": false,
     "underline": false, "strike": false, "code": false,
     "color": null, "href": "https://example.com/", "title": ""}
  ]
}
```

- `href`는 `http:`, `https:`, `mailto:`만 클릭 가능한 HWPX 필드로 출력함.
- 안전하지 않거나 잘못된 URL은 표시 텍스트만 보존함.

### list (목록)
```json
{"type": "list", "items": ["항목 하나", "항목 둘"]}
```
- 각 항목 앞에 가운뎃점(·)이 자동 부여됨.

### table (표)
```json
{"type": "table",
 "header": ["구분", "내용"],
 "rows": [["가", "나"], ["다", "라"]]}
```
- `header`는 선택. 있으면 첫 행이 음영(borderFill id=3)·굵게 처리됨.
- `rows`의 각 행은 셀 문자열 리스트. 열 수가 다르면 빈 셀로 보정됨.

### image (해결 완료 그림)

```js
{
  type: "image",
  binName: "image1.png",
  mimeType: "image/png",
  data: Uint8Array,
  widthHwp: 24000,
  heightHwp: 16000,
  alt: "설명",
  title: "",
  sourceFormat: "md"
}
```

- Renderer에 도착하기 전에 바이너리, MIME, 크기 검증이 끝나야 함.
- `binName`은 문서 안에서 고유해야 하며 `hc:img`, `content.hpf`, `BinData`, package manifest가 같은 이름으로 연결됨.
- `image-source`는 포맷 Resolver 내부 임시 타입이며 최종 Renderer에 전달하지 않음.

## 변환 시 주의

- 입력이 Markdown이면 `#`→heading, `-`/`*`→list, `|...|`→table, 그 외 문단→para로 매핑함.
- 표의 셀에 줄바꿈이 필요하면 현재 버전은 단일 단락으로 처리함(셀 내 다단락 미지원).
- 목록 항목과 표 셀은 현재 문자열 중심이므로 내부 링크·이미지는 표시 텍스트 중심으로 단순화됨.

## 예시 (완성형)

```json
{
  "title": "2026년 사업 운영계획 알림",
  "doc_type": "official",
  "blocks": [
    {"type": "heading", "level": 1, "text": "1. 목적"},
    {"type": "para", "text": "사업의 효율적 추진을 위함."},
    {"type": "list", "items": ["기간: 3월~11월", "대상: 15명"]},
    {"type": "table", "header": ["부서", "인원"], "rows": [["전략경영실", "3명"]]},
    {"type": "para", "text": "붙임. 세부계획서 1부.  끝."}
  ]
}
```
