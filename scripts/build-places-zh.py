#!/usr/bin/env python3
"""Китайские названия мест для server/data/places-zh.json (GeoNames, CC BY 4.0).

Запуск:
    python3 scripts/build-places-zh.py [КАТАЛОГ_КЭША]

Берёт id мест из server/data/places.json и ищет для них китайское название в таблицах
alternatenames/<страна>.zip. У старых id из geo.js (не «g» + geonameid) geonameid
определяется по ближайшему городу из cities500.zip той же страны.
Названия, которых нет в GeoNames, не пишутся — приложение покажет английское.
Только стандартная библиотека.
"""
import io
import json
import math
import os
import re
import sys
import tempfile
import urllib.request
import zipfile

BASE = 'https://download.geonames.org/export/dump/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACES = os.path.join(ROOT, 'server', 'data', 'places.json')
OUT = os.path.join(ROOT, 'server', 'data', 'places-zh.json')
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'geonames-cache')

# порядок предпочтения языковых меток: упрощённые иероглифы раньше общего «zh»
LANG_RANK = {'zh-CN': 0, 'zh-Hans': 1, 'zh': 2}
NOT_TOWN = re.compile(r'[路街道站场桥]$')  # улицы и станции, которые GeoNames иногда приписывает городу
CJK = re.compile(r'^[㐀-鿿·・\-（）()]+$')
# ручные правки: устоявшиеся названия, которых нет или которые неудачны в GeoNames
MANUAL = {
    'almaty': '阿拉木图', 'astana': '阿斯塔纳', 'shymkent': '奇姆肯特', 'karaganda': '卡拉干达',
    'aktobe': '阿克托别', 'taraz': '塔拉兹', 'pavlodar': '巴甫洛达尔', 'oskemen': '厄斯克门',
    'semey': '塞梅伊', 'atyrau': '阿特劳', 'kostanay': '科斯塔奈', 'kyzylorda': '克孜勒奥尔达',
    'petropavl': '彼得罗巴甫尔', 'aktau': '阿克套', 'turkestan': '突厥斯坦',
    'taldykorgan': '塔尔迪库尔干', 'kokshetau': '科克舍套', 'ekibastuz': '埃基巴斯图兹',
    'zhezkazgan': '杰兹卡兹甘', 'khorgos': '霍尔果斯', 'dostyk': '多斯特克', 'oral': '乌拉尔斯克',
    'turkistan': '突厥斯坦', 'temirtau': '铁米尔套', 'rudny': '鲁德内', 'zhanaozen': '扎瑙津',
    'balkhash': '巴尔喀什', 'kaskelen': '卡斯克连', 'baikonur': '拜科努尔', 'satbayev': '萨特帕耶夫',
    'kulsary': '库利萨雷', 'shchuchinsk': '休钦斯克', 'saran': '萨兰', 'talgar': '塔尔加尔', 'konaev': '科纳耶夫',
    'shakhtinsk': '沙赫京斯克', 'lisakovsk': '利萨科夫斯克', 'shu': '舒', 'zharkent': '扎尔肯特',
    'ayagoz': '阿亚古兹', 'aral': '阿拉尔斯克', 'kandyagash': '坎迪阿加什', 'shalkar': '沙尔卡尔',
    'saryagash': '萨雷阿加什', 'khromtau': '赫罗姆套', 'merke': '梅尔克', 'beyneu': '别伊涅乌',
    'korday': '科尔达伊', 'usharal': '乌沙拉尔', 'aksay': '阿克赛', 'esik': '叶西克', 'zhetisay': '热特赛',
    'urumqi': '乌鲁木齐', 'chelyabinsk': '车里雅宾斯克', 'samara': '萨马拉', 'ufa': '乌法', 'saratov': '萨拉托夫',
    'osh': '奥什', 'g1529569': '昌吉', 'minsk': '明斯克', 'ekaterinburg': '叶卡捷琳堡',
}


def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        urllib.request.urlretrieve(BASE + name, p)
    return p


def lines(zip_path, member=None):
    with zipfile.ZipFile(zip_path) as z:
        member = member or next(n for n in z.namelist() if n.endswith('.txt') and 'readme' not in n.lower())
        with z.open(member) as f:
            for line in io.TextIOWrapper(f, encoding='utf-8'):
                yield line.rstrip('\n').split('\t')


def norm(s):
    return re.sub(r'[^a-z]', '', s.lower())


def simplified(name):
    """Упрощённые иероглифы: такие названия кодируются в GB2312, традиционные (烏, 爾, 鐵) — нет."""
    try:
        name.encode('gb2312')
        return True
    except UnicodeEncodeError:
        return False


def dist(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 111 * k)


def main():
    places = json.load(open(PLACES, encoding='utf-8'))
    gid = {}  # id места → geonameid
    legacy = [r for r in places if not r[0].startswith('g')]
    for r in places:
        if r[0].startswith('g'):
            gid[r[0]] = r[0][1:]
    if legacy:
        by_cc = {}
        for c in lines(fetch('cities500.zip'), 'cities500.txt'):
            by_cc.setdefault(c[8], []).append((c[0], float(c[4]), float(c[5]), int(c[14] or 0), c[1], c[2]))
        for r in legacy:
            # совпадение по английскому имени рядом, иначе — просто ближайший город (не самый крупный:
            # иначе Каскелен получил бы название Алматы)
            near = [c for c in by_cc.get(r[4], []) if dist((r[5], r[6]), (c[1], c[2])) < 30]
            same = [c for c in near if norm(c[4]) == norm(r[3]) or norm(c[5]) == norm(r[3])]
            pick = same or near
            if pick:
                gid[r[0]] = min(pick, key=lambda c: dist((r[5], r[6]), (c[1], c[2])))[0]
    want = {g: i for i, g in gid.items()}
    best = {}  # id места → (ранг, название)
    for cc in sorted({r[4] for r in places}):
        for a in lines(fetch('alternatenames/%s.zip' % cc)):
            if len(a) < 4 or a[1] not in want or a[2] not in LANG_RANK:
                continue
            name = a[3].strip()
            if not CJK.match(name) or not simplified(name) or NOT_TOWN.search(name) or (len(a) > 7 and (a[6] == '1' or a[7] == '1')):
                continue  # только упрощённые иероглифы; разговорные и исторические названия не берём
            rank = (LANG_RANK[a[2]], 0 if len(a) > 4 and a[4] == '1' else 1)
            if len(name) > 2 and name.endswith('市'):
                name = name[:-1]  # «南宁市» → «南宁», как у остальных городов
            pid = want[a[1]]
            if pid not in best or rank < best[pid][0]:
                best[pid] = (rank, name)
    out = {pid: v[1] for pid, v in best.items()}
    out.update({k: v for k, v in MANUAL.items() if any(r[0] == k for r in places)})
    order = {r[0]: i for i, r in enumerate(places)}
    out = dict(sorted(out.items(), key=lambda kv: order[kv[0]]))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print('places: %d, legacy matched: %d/%d, with Chinese name: %d' % (len(places), sum(1 for r in legacy if r[0] in gid), len(legacy), len(out)), file=sys.stderr)


if __name__ == '__main__':
    main()
