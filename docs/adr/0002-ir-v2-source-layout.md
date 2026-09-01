# ADR 0002 — IR v2에 원본 레이아웃 메타데이터 보존

- 상태: 승인
- 일자: 2026-09-01

## 맥락

기존 DOCX 경로는 표 셀의 모든 문단을 한 문자열로 합치고 표를 본문 전체 폭으로 다시 계산했다. 원본 Letter 용지와 89개 수동 줄바꿈도 버려져, 표 수는 같아도 페이지가 무너졌다.

## 결정

공통 IR에 `pageSetup`, `typography`, 표 geometry와 셀 `blocks`를 추가한다. 렌더러는 DOCX를 알지 않고 이 메타데이터가 있을 때만 원본 우선 경로를 사용한다. 표 셀이 문단과 중첩 표를 포함할 수 있다는 [Microsoft Open XML TableCell 설명](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.tablecell)을 계약 근거로 삼는다.

HWPX 셀은 `hp:subList` 안에 여러 `hp:p`를 둔다. 요소 순서는 [hwpxlib](https://github.com/neolord0/hwpxlib)의 writer와 샘플 HWPX를 기준으로 검증한다.

## 결과

- 장점: 같은 IR은 입력 확장자와 무관하게 같은 HWPX를 만든다.
- 장점: 표 폭·열 비율·셀 문단·줄바꿈을 독립적으로 회귀 검사할 수 있다.
- 비용: IR preview와 renderer scan이 표 셀 내부까지 재귀해야 한다.
- 기각: DOCX 전용 HWPX 빌더 — 공용 렌더러 계약을 깨고 다른 포맷과 회귀를 분리시킨다.

