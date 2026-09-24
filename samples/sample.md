# Golden Markdown 제목 Alpha

첫 문단입니다. 한글과 English Alpha를 함께 쓰고 특수문자 & < > " ' 를 포함합니다.

작은따옴표 회귀: don't, 사용자의 '문서', **it's bold**를 원문 그대로 보존합니다.

HTML 엔티티 작은따옴표 회귀: 사용자&#39;문서, **강조&#39;문장**, 목록과 표에서도 문자 작은따옴표로 복원합니다.

---

문장 안의 `인라인 코드`는 앞뒤 문장과 같은 문단에 자연스럽게 이어집니다.

`단독 코드 문단`

- 목록 항목 하나
- 목록 항목 둘 English
- 특수문자 항목 & angle <tag>
- 엔티티 목록 사용자&#39;항목

| 구분 | 값 | 비고 |
| --- | --- | --- |
| 표 제목 | 표 값 한글 | English Cell |
| 셀 서식 | 일반과 **표 안의 굵은 글씨** | `표 안 코드` |
| 특수문자 | A & B < C > D | 긴 텍스트 long text wraps safely |
| 엔티티 | 사용자&#39;표 | 문자 작은따옴표 복원 |

```js
const message = "코드블록 Alpha & Beta";
console.log(message);
```

> Quoted Alpha line
> with **bold quote** text

[링크 텍스트](https://example.com/path?a=1&b=2)을 클릭 가능한 링크로 보존해야 합니다.

[**굵은 링크**](https://example.com/bold)도 링크와 굵게 서식을 함께 보존해야 합니다.

[위험 링크](javascript:alert(1))는 클릭 기능 없이 표시 텍스트만 보존해야 합니다.

- 관련 페이지: [청년공간 예약 안내](https://example.com/youth-space)
- 참고 자료: [운영 매뉴얼 보기](https://example.com/manual)

![삽입 이미지](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)

![상대경로 이미지](images/missing.png)
