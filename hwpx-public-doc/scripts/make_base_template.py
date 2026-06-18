#!/usr/bin/env python3
"""
make_base_template.py
검증된 최소 HWPX 베이스 템플릿을 assets/base_template/ 에 생성함.
한 번 실행해 템플릿을 만들어 두고, 이후 build_hwpx.py가 이 구조를 재사용함.
section0.xml은 build 시 동적 생성되므로 여기서는 placeholder만 둠.
"""
import os
import sys

NS_HH = "http://www.hancom.co.kr/hwpml/2011/head"
NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS_HS = "http://www.hancom.co.kr/hwpml/2011/section"
NS_OCF = "urn:oasis:names:tc:opendocument:xmlns:container"
NS_OPF = "http://www.idpf.org/2007/opf/"
NS_HV = "http://www.hancom.co.kr/hwpml/2011/version"

def w(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def build(base):
    # mimetype (내용만; ZIP 배치는 build_hwpx.py가 처리)
    w(f"{base}/mimetype", "application/hwp+zip")

    # version.xml
    w(f"{base}/version.xml",
f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:HCFVersion xmlns:hv="{NS_HV}" tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0" os="1" application="Hancom Office Hangul"/>''')

    # META-INF/container.xml
    w(f"{base}/META-INF/container.xml",
f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ocf:container xmlns:ocf="{NS_OCF}">
  <ocf:rootfiles>
    <ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>
  </ocf:rootfiles>
</ocf:container>''')

    # META-INF/container.rdf
    w(f"{base}/META-INF/container.rdf",
'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
</rdf:RDF>''')

    # META-INF/manifest.xml
    w(f"{base}/META-INF/manifest.xml",
'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
</odf:manifest>''')

    # Contents/content.hpf (package manifest)
    w(f"{base}/Contents/content.hpf",
f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="{NS_OPF}" version="" unique-identifier="" id="">
  <opf:metadata>
    <opf:title>HWPX Document</opf:title>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0" linear="yes"/>
  </opf:spine>
</opf:package>''')

    # Contents/header.xml — 글꼴·문단모양·글자모양 정의
    w(f"{base}/Contents/header.xml",
f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="{NS_HH}" version="1.4" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="2">
      <hh:fontface lang="HANGUL" fontCnt="1">
        <hh:font id="0" face="KoPubDotumMedium" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
      <hh:fontface lang="LATIN" fontCnt="1">
        <hh:font id="0" face="KoPubDotumMedium" type="TTF" isEmbedded="0">
          <hh:typeInfo familyType="FCAT_GOTHIC" weight="6" proportion="4" contrast="0" strokeVariation="1" armStyle="1" letterform="1" midline="1" xHeight="1"/>
        </hh:font>
      </hh:fontface>
    </hh:fontfaces>
    <hh:charProperties itemCnt="2">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
      <hh:charPr id="1" height="1400" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="2">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:bold/>
      </hh:charPr>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="JUSTIFY" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin><hh:intent value="0" unit="HWPUNIT"/><hh:left value="0" unit="HWPUNIT"/><hh:right value="0" unit="HWPUNIT"/><hh:prev value="0" unit="HWPUNIT"/><hh:next value="0" unit="HWPUNIT"/></hh:margin>
        <hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>
        <hh:border borderFillIDRef="2" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:borderFills itemCnt="3">
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
      <hh:borderFill id="3" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/>
        <hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>
        <hh:fillBrush>
          <hh:winBrush faceColor="#E6E6E6" hatchColor="#000000" alpha="0"/>
        </hh:fillBrush>
      </hh:borderFill>
    </hh:borderFills>
  </hh:refList>
</hh:head>''')

    # Contents/section0.xml — placeholder (build가 덮어씀)
    w(f"{base}/Contents/section0.xml",
f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="{NS_HS}" xmlns:hp="{NS_HP}">
  <hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>
</hs:sec>''')

    # settings.xml
    w(f"{base}/settings.xml",
'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>''')

    # Preview/PrvText.txt
    w(f"{base}/Preview/PrvText.txt", "HWPX Document")
    # Preview/PrvImage.png — 1x1 투명 PNG (최소 바이트)
    png = bytes([
        0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,
        0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
        0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,
        0x0D,0x49,0x44,0x41,0x54,0x78,0x9C,0x62,0x00,0x01,0x00,0x00,
        0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,
        0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
    ])
    os.makedirs(f"{base}/Preview", exist_ok=True)
    with open(f"{base}/Preview/PrvImage.png", "wb") as f:
        f.write(png)

    print(f"[OK] 베이스 템플릿 생성 완료: {base}")

if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "assets/base_template"
    build(base)
