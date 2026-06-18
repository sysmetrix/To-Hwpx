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

## 변환 시 주의

- 입력이 Markdown이면 `#`→heading, `-`/`*`→list, `|...|`→table, 그 외 문단→para로 매핑함.
- 표의 셀에 줄바꿈이 필요하면 현재 버전은 단일 단락으로 처리함(셀 내 다단락 미지원).
- 이미지·수식은 현재 IR에서 미지원. 필요 시 별도 확장 블록 타입 추가.

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
