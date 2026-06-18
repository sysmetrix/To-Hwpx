#!/usr/bin/env python3
"""
build_hwpx.py
IR(구조화 단락 JSON)을 받아 베이스 템플릿 위에 section0.xml만 동적 생성하고
mimetype을 ZIP_STORED로 첫 배치하여 .hwpx로 패키징함.

원칙(외과적 생성): 베이스 템플릿의 고정 파일은 그대로 복사하고, section0.xml만 교체함.

사용:
  python build_hwpx.py --ir ir.json --out output.hwpx [--template assets/base_template]
"""
import argparse
import json
import os
import shutil
import tempfile
import zipfile
from xml.sax.saxutils import escape

NS_HS = "http://www.hancom.co.kr/hwpml/2011/section"
NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

# charPrIDRef: 0=본문(10pt), 1=제목(14pt bold) — header.xml 정의와 일치
CHAR_BODY = "0"
CHAR_HEAD = "1"


def esc(s):
    return escape(str(s)) if s is not None else ""


def para(text, char_id=CHAR_BODY, para_id="0"):
    """단일 단락 XML 생성"""
    return (
        f'<hp:p paraPrIDRef="{para_id}" styleIDRef="0">'
        f'<hp:run charPrIDRef="{char_id}"><hp:t>{esc(text)}</hp:t></hp:run>'
        f'</hp:p>'
    )


def build_table(header, rows):
    """표 XML 생성. header=열 제목 리스트, rows=행 리스트(각 행은 셀 리스트)."""
    all_rows = ([header] if header else []) + rows
    n_rows = len(all_rows)
    n_cols = max((len(r) for r in all_rows), default=1)

    cells_xml = []
    for r_idx, row in enumerate(all_rows):
        for c_idx in range(n_cols):
            val = row[c_idx] if c_idx < len(row) else ""
            is_header = (header and r_idx == 0)
            char_id = CHAR_HEAD if is_header else CHAR_BODY
            border_fill = "3" if is_header else "2"  # 헤더는 음영
            cell = (
                f'<hp:tc name="" header="{"1" if is_header else "0"}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="{border_fill}">'
                f'<hp:cellAddr colAddr="{c_idx}" rowAddr="{r_idx}"/>'
                f'<hp:cellSpan colSpan="1" rowSpan="1"/>'
                f'<hp:cellSz width="8000" height="1000"/>'
                f'<hp:cellMargin left="510" right="510" top="141" bottom="141"/>'
                f'<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                f'{para(val, char_id)}'
                f'</hp:subList>'
                f'</hp:tc>'
            )
            cells_xml.append((r_idx, cell))

    rows_xml = ""
    for r_idx in range(n_rows):
        row_cells = "".join(c for ri, c in cells_xml if ri == r_idx)
        rows_xml += f'<hp:tr>{row_cells}</hp:tr>'

    tbl = (
        f'<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">'
        f'<hp:tbl id="0" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" '
        f'dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="{n_rows}" colCnt="{n_cols}" cellSpacing="0" borderFillIDRef="2">'
        f'<hp:sz width="48000" widthRelTo="ABSOLUTE" height="{n_rows*1000}" heightRelTo="ABSOLUTE" protect="0"/>'
        f'<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
        f'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        f'<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
        f'<hp:inMargin left="510" right="510" top="141" bottom="141"/>'
        f'{rows_xml}'
        f'</hp:tbl></hp:run></hp:p>'
    )
    return tbl


def build_section(ir):
    """IR blocks를 section0.xml 본문으로 변환"""
    parts = []
    title = ir.get("title")
    if title:
        parts.append(para(title, CHAR_HEAD))
        parts.append(para(""))  # 제목 아래 공백 단락

    for b in ir.get("blocks", []):
        bt = b.get("type")
        if bt == "heading":
            char_id = CHAR_HEAD if b.get("level", 1) <= 2 else CHAR_BODY
            parts.append(para(b.get("text", ""), char_id))
        elif bt == "para":
            parts.append(para(b.get("text", "")))
        elif bt == "list":
            for item in b.get("items", []):
                parts.append(para(f"· {item}"))
        elif bt == "table":
            parts.append(build_table(b.get("header"), b.get("rows", [])))
        else:
            # 알 수 없는 블록은 텍스트로 폴백
            if "text" in b:
                parts.append(para(b["text"]))

    if not parts:
        parts.append(para(""))

    body = "".join(parts)
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<hs:sec xmlns:hs="{NS_HS}" xmlns:hp="{NS_HP}">'
        f'{body}'
        f'</hs:sec>'
    )


def package_hwpx(staging_dir, out_path):
    """
    ZIP_STORED 규칙 준수 패키징:
    - mimetype을 첫 항목으로, 무압축(ZIP_STORED)으로 기록
    - 나머지는 DEFLATE
    """
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    with zipfile.ZipFile(out_path, "w") as zf:
        # 1) mimetype 먼저, 무압축
        mpath = os.path.join(staging_dir, "mimetype")
        zi = zipfile.ZipInfo("mimetype")
        zi.compress_type = zipfile.ZIP_STORED
        with open(mpath, "rb") as f:
            zf.writestr(zi, f.read())

        # 2) 나머지 파일 DEFLATE
        for root, _, files in os.walk(staging_dir):
            for name in files:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, staging_dir).replace(os.sep, "/")
                if rel == "mimetype":
                    continue
                zf.write(full, rel, compress_type=zipfile.ZIP_DEFLATED)

    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ir", required=True, help="IR JSON 경로")
    ap.add_argument("--out", required=True, help="출력 .hwpx 경로")
    ap.add_argument("--template", default=None, help="베이스 템플릿 경로")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    skill_dir = os.path.dirname(script_dir)
    template = args.template or os.path.join(skill_dir, "assets", "base_template")

    if not os.path.isdir(template):
        print(f"[ERROR] 베이스 템플릿 없음: {template}")
        print("        make_base_template.py를 먼저 실행하세요.")
        return 1

    with open(args.ir, encoding="utf-8") as f:
        ir = json.load(f)

    # 외과적 생성: 템플릿 전체 복사 후 section0.xml만 교체
    staging = tempfile.mkdtemp(prefix="hwpx_build_")
    try:
        shutil.copytree(template, staging, dirs_exist_ok=True)
        section_xml = build_section(ir)
        with open(os.path.join(staging, "Contents", "section0.xml"), "w", encoding="utf-8") as f:
            f.write(section_xml)

        out = package_hwpx(staging, args.out)
        print(f"[OK] 생성 완료: {out}")
        return 0
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
