#!/usr/bin/env python3
"""Сборка справочника населённых пунктов server/data/places.json из выгрузок GeoNames.

Источник: https://download.geonames.org/export/dump/ (GeoNames, CC BY 4.0).
Формат таблиц описан в readme.txt той же папки.

Запуск:
    python3 scripts/build-places.py [КАТАЛОГ_КЭША] [--kz-strict] [--out ФАЙЛ]

Выгрузки скачиваются в каталог кэша (по умолчанию <tmp>/geonames-cache) и повторно
не запрашиваются, поэтому повторный запуск на том же кэше даёт байт-в-байт тот же файл.
Чтобы обновить данные, удалите каталог кэша.

Строка результата: [id, ru, kz, en, country, lat, lon, region, pop]
  id      – id из server/geo.js для уже существующих городов, иначе "g" + geonameid;
  region  – область / город респ. значения по-русски (только Казахстан).

Порядок работы: отбор → автоматические имена → ручные правки (таблицы ниже) → отсев строк
без русского имени и исключений → дубликаты → области → сортировка.
Используется только стандартная библиотека.
"""
import bisect
import difflib
import io
import json
import math
import os
import re
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile

BASE = 'https://download.geonames.org/export/dump/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_JS = os.path.join(ROOT, 'server', 'geo.js')
OUT = os.path.join(ROOT, 'server', 'data', 'places.json')

# =============================================================================
# Ручные правки (ключ – geonameid). Применяются после автоматики и только если
# текущее значение GeoNames совпадает с ожидаемым: если GeoNames исправит запись
# или id начнёт означать другое место, правка молча не сработает и попадёт в отчёт.
# =============================================================================

# geonameid: (ожидаемое автоматическое ru, новое ru, новое kz или None, новое en или None)
NAME_FIX = {
    # Казахстан: устаревшие названия
    1516438: ('Зыряновск', 'Алтай', 'Алтай', None),
    1519230: ('Чилик', 'Шелек', 'Шелек', None),
    1522035: ('Красноармейск', 'Тайынша', 'Тайынша', None),
    1518622: ('Красноармейск', 'Тайынша', 'Тайынша', None),   # вторая запись того же города
    1524138: ('Ильич', 'Атакент', 'Атакент', None),
    1522643: ('Кировский', 'Асыката', 'Асықата', None),
    1525126: ('Боровое', 'Бурабай', 'Бурабай', None),
    1517073: ('Затобольск', 'Тобыл', 'Тобыл', None),
    1517443: ('Вишнёвка', 'Аршалы', 'Аршалы', None),
    1522021: ('Краснокутск', 'Актогай', 'Ақтоғай', None),
    1516789: ('Новоказалинск', 'Айтеке-Би', 'Әйтеке би', 'Aiteke Bi'),
    # Казахстан: брак в русском имени GeoNames
    1523966: ('им.кошевого', 'Кошевое', None, None),
    1523900: ('им.некрасова', 'Некрасовка', None, None),
    1523857: ('им.свердлова', 'Свердловка', None, None),
    1523860: ('им.суворова', 'Суворово', None, None),
    # Казахстан: русского имени в GeoNames нет, автоматика подставляет казахское
    13535800: ('Қабыланбек', 'Кабыланбек', None, None),
    1519463: ('Саяқ', 'Саяк', None, None),
    1529724: ('Шалқия', 'Шалкия', None, None),
    1526573: ('Ақтоғай', 'Актогай', None, None),
    1537980: ('Үлкен', 'Улькен', None, None),
    1537909: ('Шұбаркөл', 'Шубарколь', None, None),
    1517474: ('Жоғарғы Қайрақты', 'Жогаргы Кайракты', None, None),
    # ...и казахское имя совпадает с русским написанием (иначе строка отсеялась бы)
    1520381: ('Денисовка', 'Денисовка', None, None),
    1520844: ('Мойынты', 'Мойынты', None, None),
    1521296: ('Луганск', 'Луганск', None, None),
    1520425: ('Октябрьское', 'Октябрьское', None, None),
    608393: ('Семиглавый Мар', 'Семиглавый Мар', None, None),
    # Другие страны
    1529377: ('Qarasu', 'Хоргос (КНР)', 'Қорғас (ҚХР)', 'Khorgos (China)'),
    298333: ('Эдесса', 'Шанлыурфа', None, None),
    323779: ('Антиохия', 'Антакья', None, None),
    1220747: ('Курган Тюбе', 'Бохтар', None, None),
    128747: ('Карай', 'Кередж', None, None),
    1529435: ('Гхуля', 'Кульджа (Инин)', 'Құлжа', None),
    1788534: ('Цзинань', 'Синьян', None, None),
    12492662: ('Мяньжу, Деянг, Сичуань', 'Мяньчжу', None, 'Mianzhu'),
}

# geonameid: (ожидаемое имя GeoNames, новое en) – для существующих id из geo.js
EN_FIX = {
    1524537: ('Druzhba', 'Dostyk'),        # dostyk
    609655: ('Karagandy', 'Karaganda'),    # karaganda
    608668: ('Oral', 'Uralsk'),            # oral
    1525798: ('Balqash', 'Balkhash'),      # balkhash
}

# geonameid: (ожидаемое население GeoNames, новое) – приблизительно, только ради сортировки
POP_FIX = {
    1519931: (0, 76000),       # kaskelen
    1517836: (0, 17000),       # usharal
    1519691: (76919, 13000),   # Сарканд
    608362: (27072, 0),        # Шалкар (Атырауская обл.) – чужое население
}

# geonameid: ожидаемое имя GeoNames. Районы внутри городов и дубликаты.
EXCLUDE = {
    # Шанхай
    1798524: 'Pudong', 1800480: 'Minhang', 1816917: 'Baoshan', 1794035: 'Songjiang',
    1806508: 'Jiading', 1797798: 'Qingpu', 1798439: 'Putuo', 1787375: 'Yangpu',
    13608002: 'Fengxiang', 1787957: 'Xuhui', 13608000: 'Jinshan', 1815611: 'Changning',
    1808090: 'Hongkou', 8307452: 'Huangpu', 13608003: 'Chongming',
    # Стамбул
    747323: 'Esenyurt', 742394: 'Küçükçekmece', 751324: 'Bağcılar', 7627067: 'Bahçelievler',
    738377: 'Ümraniye', 738329: 'Üsküdar', 747340: 'Esenler', 7628420: 'Sancaktepe',
    7628416: 'Sultangazi', 741763: 'Maltepe', 6947640: 'Beylikdüzü', 6947637: 'Ataşehir',
    7628419: 'Sultanbeyli', 747158: 'Fatih', 739549: 'Şişli',
    # Анкара, Измир
    6955677: 'Çankaya',
    7701384: 'Karabağlar', 320857: 'Bornova', 308988: 'Karşıyaka', 306641: 'Konak',
    # Москва, Санкт-Петербург
    11238229: 'Obruchevo', 569273: 'Cherëmushki', 8505053: 'Vostochnoe Degunino',
    511510: 'Novo-Peredelkino', 510225: 'Petrodvorets',
    # дубликаты
    12750521: 'Kisilevsk', 13631665: 'gorod Solnetchnogorsk',
}

# Код admin1 GeoNames → область / город республиканского значения (17 областей + 3 города).
# Байконур (08) – отдельный код GeoNames, территориально Кызылординская область.
KZ_REGIONS = {
    '01': 'Алматинская область', '02': 'Алматы', '03': 'Акмолинская область',
    '04': 'Актюбинская область', '05': 'Астана', '06': 'Атырауская область',
    '07': 'Западно-Казахстанская область', '08': 'Кызылординская область',
    '09': 'Мангистауская область', '10': 'Туркестанская область',
    '11': 'Павлодарская область', '12': 'Карагандинская область',
    '13': 'Костанайская область', '14': 'Кызылординская область',
    '15': 'Восточно-Казахстанская область', '16': 'Северо-Казахстанская область',
    '17': 'Жамбылская область', '1537272': 'Шымкент',
    '12510143': 'Абайская область', '12510144': 'Жетысуская область',
    '12510145': 'Улытауская область',
}
# Реформа 2022 г.: старый код → код выделенной из него области.
KZ_SPLIT = {'15': '12510143', '01': '12510144', '12': '12510145'}
SPLIT_NEIGHBOURS = 7     # старый код меняем, только если все 7 ближайших соседей – в новой области
REGION_NEIGHBOURS = 5    # область для точки без кода – по большинству из 5 ближайших с кодом

# --- Правила отбора ---------------------------------------------------------
# Казахстан: класс P с русским именем кириллицей И (население > 0 ИЛИ есть казахское имя
# ИЛИ административный центр). С --kz-strict точке без населения нужны оба имени.
KZ_SEATS = {'PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4'}
SKIP_CODES = {'PPLX', 'PPLH', 'PPLQ', 'PPLW'}   # части городов, исторические, покинутые, уничтоженные
FOREIGN_MIN_POP = {
    'RU': 50000, 'UZ': 50000, 'KG': 50000, 'TJ': 50000, 'TM': 50000,
    'BY': 50000, 'AZ': 50000, 'GE': 50000, 'AM': 50000, 'MN': 50000,
    'CN': 500000,
    'TR': 300000, 'IR': 300000, 'PL': 300000, 'DE': 300000,
    'LT': 300000, 'LV': 300000, 'UA': 300000, 'AF': 300000,
}
CN_NEAR_MIN_POP = 50000                         # Китай у границы с Казахстаном
CN_NEAR_BOX = (35.0, 50.0, 73.0, 96.0)          # lat_min, lat_max, lon_min, lon_max
MATCH_KM = 40.0                                 # существующий город ↔ GeoNames
DEDUP_KM = 5.0                                  # одноимённые точки ближе этого – дубликаты
PREFER_CLOSEST = True                           # см. pick_name()
SIZE_BUDGET = 900 * 1000                        # байт на весь файл

LATIN = re.compile(r'[A-Za-zÀ-ɏ]')
CYRILLIC = re.compile(r'[Ѐ-ӿ]')
OTHER_SCRIPT = re.compile(r'[Ͱ-Ͽ԰-ۿऀ-෿぀-鿿가-힯]')
KAZAKH_ONLY = re.compile(r'[ӘәҒғҚқҢңӨөҰұҮүҺһІі]')
FEATURE_RANK = {'PPLC': 0, 'PPLA': 1, 'PPLA2': 2, 'PPLA3': 3, 'PPLA4': 4}


def log(*a):
    print(*a, file=sys.stderr)


def fetch(cache, rel):
    """Скачать BASE/rel в кэш (если ещё нет) и вернуть локальный путь."""
    path = os.path.join(cache, *rel.split('/'))
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    log('download', BASE + rel)
    req = urllib.request.Request(BASE + rel, headers={'User-Agent': 'places-builder/1.0'})
    tmp = path + '.part'
    with urllib.request.urlopen(req, timeout=300) as r, open(tmp, 'wb') as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)
    return path


def zip_lines(path, member):
    with zipfile.ZipFile(path) as z, z.open(member) as raw:
        for line in io.TextIOWrapper(raw, 'utf-8', newline='\n'):
            yield line.rstrip('\n').split('\t')


def read_geonames(path, member):
    """Таблица 'geoname' (19 колонок, см. readme.txt) → список словарей."""
    out = []
    for c in zip_lines(path, member):
        if len(c) < 19:
            continue
        out.append({
            'gid': int(c[0]), 'name': c[1], 'ascii': c[2],
            'lat': float(c[4]), 'lon': float(c[5]),
            'fclass': c[6], 'fcode': c[7], 'cc': c[8], 'adm1': c[10],
            'pop': int(c[14] or 0),
        })
    return out


def read_altnames(path, member, wanted):
    """Таблица 'alternate names' → {geonameid: [(lang, name, pref, colloquial, historic)]}.

    Берём только нужные geonameid и языки ru / kk / без метки; порядок – как в файле.
    """
    out = {}
    for c in zip_lines(path, member):
        if len(c) < 8 or c[2] not in ('ru', 'kk', ''):
            continue
        gid = int(c[1])
        if gid not in wanted:
            continue
        out.setdefault(gid, []).append((c[2], c[3].strip(), c[4] == '1', c[6] == '1', c[7] == '1'))
    return out


def script_ok(name, lang):
    """Имя действительно записано кириллицей (а не латинская транслитерация / арабица)."""
    if not name or LATIN.search(name) or OTHER_SCRIPT.search(name) or not CYRILLIC.search(name):
        return False
    if '_' in name:
        return False  # брак вида «Улкен_енбек»
    if lang == 'ru' and KAZAKH_ONLY.search(name):
        return False  # казахское написание, ошибочно помеченное как русское
    return True


_TRANSLIT = dict(zip('абвгдезийклмнопрстуфыэ', 'abvgdeziyklmnoprstufye'))
_TRANSLIT.update({'ж': 'zh', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ю': 'yu', 'я': 'ya',
                  'ё': 'yo', 'ъ': '', 'ь': '', 'ә': 'a', 'ғ': 'gh', 'қ': 'q', 'ң': 'ng', 'ө': 'o',
                  'ұ': 'u', 'ү': 'u', 'һ': 'h', 'і': 'i'})


def _latin_key(s):
    s = ''.join(_TRANSLIT.get(ch, ch) for ch in s.lower())
    return ''.join(ch for ch in unicodedata.normalize('NFKD', s) if ch.isascii() and ch.isalnum())


def similarity(cyr, latin):
    return difflib.SequenceMatcher(None, _latin_key(cyr), _latin_key(latin)).ratio()


def pick_name(alts, lang, like=None):
    """Имя на языке lang из списка альтернативных имён.

    1) предпочтительное (isPreferredName), не историческое;
    2) иначе первое не историческое и не разговорное.
    Если на шаге 2 кандидатов несколько и задано `like` (основное латинское имя GeoNames),
    берётся ближайший к нему по транслитерации, при равенстве – первый. Без этого «первым»
    часто оказывается советское название (Георгиевка вместо Калбатау, Ленинское вместо Казыгурт).
    Чтобы вернуть строгое правило «первое», установите PREFER_CLOSEST = False.
    """
    live = [a for a in alts if a[0] == lang and not a[4] and script_ok(a[1], lang)]
    for a in live:
        if a[2]:
            return a[1]
    cand = [a[1] for a in live if not a[3]]
    if not cand:
        return ''
    if PREFER_CLOSEST and like and len(cand) > 1:
        return max(cand, key=lambda n: similarity(n, like))  # max() возвращает первый из равных
    return cand[0]


def en_name(p):
    return p['name'] if LATIN.search(p['name']) else p['ascii']


def km(lat1, lon1, lat2, lon2):
    r = math.radians
    h = (math.sin(r(lat2 - lat1) / 2) ** 2
         + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2)
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def norm(s):
    return re.sub(r'[\s\-’\'ʼ]+', ' ', s.casefold().replace('ё', 'е')).strip()


def read_existing():
    """Массив RAW из server/geo.js: [id, ru, kz, country, lat, lon]."""
    src = open(GEO_JS, encoding='utf-8').read()
    body = src[src.index('const RAW = ['):]
    body = body[:body.index('];')]
    rows = re.findall(
        r"\[\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([A-Z]{2})'\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]",
        body)
    return [{'id': r[0], 'ru': r[1], 'kz': r[2], 'cc': r[3], 'lat': float(r[4]), 'lon': float(r[5])}
            for r in rows]


def match_existing(e, pool, alts):
    """Найти запись GeoNames для существующего города: та же страна, <= 40 км, совпало имя."""
    want = {norm(e['ru']), norm(e['kz'])}
    best = None
    for p in pool:
        if p['cc'] != e['cc'] or abs(p['lat'] - e['lat']) > 0.5:
            continue
        d = km(e['lat'], e['lon'], p['lat'], p['lon'])
        if d > MATCH_KM:
            continue
        level = 0
        for lang, name, _pref, _coll, hist in alts.get(p['gid'], ()):
            if norm(name) in want:
                level = max(level, 2 if (lang in ('ru', 'kk') and not hist) else 1)
        if not level:
            continue
        key = (level, p['pop'], -d, -p['gid'])
        if best is None or key > best[0]:
            best = (key, p)
    return best[1] if best else None


class Nearest:
    """k ближайших точек из набора (точный поиск в расширяющейся полосе широт)."""

    def __init__(self, places):
        self.places = sorted(places, key=lambda p: (p['lat'], p['gid']))
        self.lats = [p['lat'] for p in self.places]

    def query(self, lat, lon, k, skip_gid=0):
        w = 1.0
        while True:
            i0 = bisect.bisect_left(self.lats, lat - w)
            i1 = bisect.bisect_right(self.lats, lat + w)
            found = sorted((km(lat, lon, p['lat'], p['lon']), p['gid'], p['adm1'])
                           for p in self.places[i0:i1] if p['gid'] != skip_gid)[:k]
            whole = i0 == 0 and i1 == len(self.lats)
            if whole or (len(found) == k and found[-1][0] <= w * 110.0):
                return found
            w *= 2


def assign_regions(recs, kz_pool):
    """Область для строк Казахстана. Возвращает счётчики для отчёта."""
    coded = [p for p in kz_pool if p['adm1'] in KZ_REGIONS]
    everything = Nearest(coded)
    split_index = {old: Nearest([p for p in coded if p['adm1'] in (old, new)])
                   for old, new in KZ_SPLIT.items()}
    stat = {'by_code': 0, 'moved_to_new_region': [], 'by_neighbours': 0}
    for r in recs:
        code = r['adm1']
        if code in KZ_SPLIT:
            # Код старой области мог остаться после реформы 2022 г. Меняем только в
            # однозначном случае: все ближайшие соседи (со старым или новым кодом) – в новой.
            new = KZ_SPLIT[code]
            near = split_index[code].query(r['lat'], r['lon'], SPLIT_NEIGHBOURS, r['gid'])
            if len(near) == SPLIT_NEIGHBOURS and all(n[2] == new for n in near):
                code = new
                stat['moved_to_new_region'].append('%s %s' % (r['id'], r['ru']))
        if code in KZ_REGIONS:
            stat['by_code'] += 1
        else:
            # Кода нет («00») – берём область большинства ближайших точек с кодом
            # (на контрольной выборке 98,5 % совпадений против 93 % у «ближайшего райцентра»).
            near = everything.query(r['lat'], r['lon'], REGION_NEIGHBOURS, r['gid'])
            votes = {}
            for i, n in enumerate(near):
                v = votes.setdefault(n[2], [0, i])
                v[0] += 1
            code = min(votes, key=lambda c: (-votes[c][0], votes[c][1])) if votes else ''
            stat['by_neighbours'] += 1
        r['region'] = KZ_REGIONS.get(code, '')
    return stat


def main(argv):
    cache = os.path.join(tempfile.gettempdir(), 'geonames-cache')
    out_path = OUT
    kz_strict = False
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == '--kz-strict':
            kz_strict = True
        elif a == '--out':
            out_path = args.pop(0)
        elif a in ('-h', '--help'):
            print(__doc__)
            return 0
        else:
            cache = a

    existing = read_existing()
    log('existing ids in geo.js:', len(existing))
    foreign_cc = sorted(set(FOREIGN_MIN_POP) | {e['cc'] for e in existing if e['cc'] != 'KZ'})

    # --- загрузка -------------------------------------------------------------
    kz_all = [p for p in read_geonames(fetch(cache, 'KZ.zip'), 'KZ.txt') if p['cc'] == 'KZ']
    kz_pool = [p for p in kz_all if p['fclass'] == 'P' and p['fcode'] not in ('PPLH', 'PPLQ', 'PPLW')]
    cities = [p for p in read_geonames(fetch(cache, 'cities15000.zip'), 'cities15000.txt')
              if p['fclass'] == 'P' and p['cc'] in foreign_cc]

    adm1_gid = {}  # код admin1 Казахстана → geonameid области (для сверки названий)
    with open(fetch(cache, 'admin1CodesASCII.txt'), encoding='utf-8') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            if len(c) >= 4 and c[0].startswith('KZ.'):
                adm1_gid[c[0][3:]] = int(c[3])

    # --- отбор: другие страны ------------------------------------------------
    la0, la1, lo0, lo1 = CN_NEAR_BOX
    fo_sel = {}
    for p in cities:
        if p['fcode'] in SKIP_CODES or p['cc'] not in FOREIGN_MIN_POP:
            continue
        ok = p['pop'] >= FOREIGN_MIN_POP[p['cc']]
        if p['cc'] == 'CN' and not ok:
            ok = p['pop'] >= CN_NEAR_MIN_POP and la0 <= p['lat'] <= la1 and lo0 <= p['lon'] <= lo1
        if ok:
            fo_sel[p['gid']] = p

    # --- альтернативные имена -------------------------------------------------
    near = set()  # зарубежные кандидаты для сопоставления существующих городов (<= 40 км)
    for e in existing:
        if e['cc'] != 'KZ':
            for p in cities:
                if p['cc'] == e['cc'] and abs(p['lat'] - e['lat']) <= 0.5 \
                        and km(e['lat'], e['lon'], p['lat'], p['lon']) <= MATCH_KM:
                    near.add(p['gid'])
    wanted = {p['gid'] for p in kz_pool} | set(fo_sel) | near | set(adm1_gid.values())
    alts = {}
    for cc in ['KZ'] + foreign_cc:
        alts.update(read_altnames(fetch(cache, 'alternatenames/%s.zip' % cc), cc + '.txt', wanted))

    names = {}  # geonameid → (en, ru из GeoNames или '', kk из GeoNames или '')

    def auto_names(p):
        if p['gid'] not in names:
            a = alts.get(p['gid'], ())
            en = en_name(p)
            names[p['gid']] = (en, pick_name(a, 'ru', en), pick_name(a, 'kk', en))
        return names[p['gid']]

    # Сверка таблицы KZ_REGIONS с названиями областей в GeoNames.
    for code, gid in sorted(adm1_gid.items()):
        theirs = re.sub(r'\s+Область$', ' область', pick_name(alts.get(gid, ()), 'ru'))
        if code not in KZ_REGIONS:
            log('WARNING: admin1 code KZ.%s (%s) is not in KZ_REGIONS' % (code, theirs))
        elif norm(theirs) != norm(KZ_REGIONS[code]):
            log('note: KZ.%s is "%s" in GeoNames, "%s" here' % (code, theirs, KZ_REGIONS[code]))

    # --- отбор: Казахстан -----------------------------------------------------
    # Русское имя проверяется позже, после ручных правок (они могут его дать).
    kz_sel = {}
    for p in kz_pool:
        if p['fcode'] in SKIP_CODES or (p['fcode'] == 'PPLL' and p['pop'] == 0):
            continue
        has_kk = bool(auto_names(p)[2])
        if p['pop'] > 0 or (has_kk if kz_strict else (has_kk or p['fcode'] in KZ_SEATS)):
            kz_sel[p['gid']] = p

    # --- сопоставление существующих городов ----------------------------------
    by_gid = {p['gid']: p for p in kz_pool}
    by_gid.update({p['gid']: p for p in cities})
    matched = {}     # geonameid → существующая запись
    unmatched = []
    for e in existing:
        p = match_existing(e, kz_pool if e['cc'] == 'KZ' else cities, alts)
        if p is not None and p['gid'] not in matched:
            matched[p['gid']] = e
        else:
            unmatched.append(e)

    # --- строки + ручные правки -----------------------------------------------
    recs = []
    fix_log = {t: {'applied': [], 'mismatch': []} for t in ('NAME_FIX', 'EN_FIX', 'POP_FIX', 'EXCLUDE')}
    seen_gids = set()

    def fix(table, gid, ok, label):
        fix_log[table]['applied' if ok else 'mismatch'].append(label)
        return ok

    def add(p, e=None):
        en, ru_real, kk_real = auto_names(p) if p else ('', '', '')
        cc = p['cc'] if p else e['cc']
        gid = p['gid'] if p else 0
        pop = p['pop'] if p else 0
        seen_gids.add(gid)
        if e is not None:
            rid, ru, kz = e['id'], e['ru'], e['kz']
            en = en or e['id'].capitalize()
        else:
            rid = 'g%d' % gid
            ru = ru_real or (kk_real if cc == 'KZ' else '') or en
            kz = kk_real or ru
            if gid in NAME_FIX:
                want, new_ru, new_kz, new_en = NAME_FIX[gid]
                if fix('NAME_FIX', gid, ru == want, '%s %s→%s (GeoNames: %s)' % (rid, want, new_ru, ru)):
                    ru, kz, en = new_ru, new_kz or kk_real or new_ru, new_en or en
                    ru_real = ru
        if gid in EN_FIX:
            want, new_en = EN_FIX[gid]
            if fix('EN_FIX', gid, en == want, '%s %s→%s (GeoNames: %s)' % (rid, want, new_en, en)):
                en = new_en
        if gid in POP_FIX:
            want, new_pop = POP_FIX[gid]
            if fix('POP_FIX', gid, pop == want, '%s %s %d→%d (GeoNames: %d)' % (rid, ru, want, new_pop, pop)):
                pop = new_pop
        if gid in EXCLUDE and e is None:
            if fix('EXCLUDE', gid, en == EXCLUDE[gid], '%s %s (GeoNames: %s)' % (rid, EXCLUDE[gid], en)):
                return
        recs.append({
            'id': rid, 'ru': ru, 'kz': kz, 'en': en, 'cc': cc,
            'lat': round(p['lat'] if p else e['lat'], 4),
            'lon': round(p['lon'] if p else e['lon'], 4),
            'region': '', 'pop': pop,
            'adm1': p['adm1'] if p else '',
            'fixed': e is not None,
            'has_ru': e is not None or bool(ru_real),
            'kz_src': 'geo.js' if e is not None else ('kk' if kk_real else 'fallback'),
            'rank': FEATURE_RANK.get(p['fcode'], 9) if p else 9,
            'gid': gid,
        })

    for gid, e in matched.items():
        add(by_gid[gid], e)
    for e in unmatched:
        add(None, e)
    for gid, p in list(kz_sel.items()) + list(fo_sel.items()):
        if gid not in matched:
            add(p)

    # --- отсев: нет русского имени кириллицей (кроме существующих id) ----------
    no_ru = [r for r in recs if not r['fixed'] and not (r['has_ru'] and script_ok(r['ru'], 'ru'))]
    recs = [r for r in recs if r['fixed'] or (r['has_ru'] and script_ok(r['ru'], 'ru'))]

    # --- дубликаты: одно и то же имя ближе 5 км → оставить более населённый -------
    # Сравниваем русское имя, а также казахское и латинское: GeoNames нередко держит один
    # посёлок двумя записями с разным русским написанием (Новоишимский / Новоишимское).
    # Существующие id не удаляются никогда.
    recs.sort(key=lambda r: (not r['fixed'], -r['pop'], r['rank'], r['gid'], r['id']))
    kept, seen, dropped = [], {}, []
    for r in recs:
        keys = {(r['cc'], f, norm(r[f])) for f in ('ru', 'kz', 'en') if r[f]}
        if not r['fixed'] and any(km(r['lat'], r['lon'], o['lat'], o['lon']) <= DEDUP_KM
                                  for k in keys for o in seen.get(k, ())):
            dropped.append(r)
            continue
        for k in keys:
            seen.setdefault(k, []).append(r)
        kept.append(r)

    # --- области Казахстана ---------------------------------------------------
    kz = [r for r in kept if r['cc'] == 'KZ']
    region_stat = assign_regions(kz, kz_pool)

    # --- сортировка -----------------------------------------------------------
    # Отделения совхозов, фермы, зимовки, бригады и разъезды – не населённые пункты для перевозок.
    not_a_place = re.compile(r'^(ферма|совхоз|отделение|зимовка|разъезд|бригада|участок|кошара|отгон)\b', re.I)
    existing_ids = {e['id'] for e in existing}
    kept = [r for r in kept if r['id'] in existing_ids or r['pop'] > 0 or not not_a_place.match(r['ru'])]

    # Казахстан, затем остальные. Внутри: население по убыванию, затем административные
    # центры раньше сёл, затем по алфавиту – клиент показывает первые совпадения по порядку.
    kept.sort(key=lambda r: (r['cc'] != 'KZ', -r['pop'], r['rank'], norm(r['ru']), r['id']))
    rows = [[r['id'], r['ru'], r['kz'], r['en'], r['cc'], r['lat'], r['lon'], r['region'], r['pop']]
            for r in kept]

    ids = [r[0] for r in rows]
    have = set(ids)
    assert len(ids) == len(have), 'duplicate ids'
    assert all(r[1] and r[2] and r[3] for r in rows), 'empty name'
    assert all(e['id'] in have for e in existing), 'existing id lost'
    assert all(r[7] in set(KZ_REGIONS.values()) for r in rows if r[4] == 'KZ'), 'KZ row without region'

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    data = json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + '\n'
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(data)

    # --- отчёт ----------------------------------------------------------------
    size = len(data.encode('utf-8'))
    per_cc = {}
    for r in rows:
        per_cc[r[4]] = per_cc.get(r[4], 0) + 1
    log('rows: %d | KZ rows: %d | bytes: %d (budget %d%s) | kz-strict: %s'
        % (len(rows), len(kz), size, SIZE_BUDGET, '' if size <= SIZE_BUDGET else ' EXCEEDED', kz_strict))
    log('per country:', ' '.join('%s=%d' % kv for kv in sorted(per_cc.items(), key=lambda kv: (-kv[1], kv[0]))))
    log('existing matched: %d, unmatched (old coordinates kept): %s'
        % (len(matched), [e['id'] for e in unmatched] or 'none'))
    log('KZ population: >0: %d, =0: %d' % (sum(1 for r in kz if r['pop'] > 0), sum(1 for r in kz if r['pop'] == 0)))
    log('KZ kz-name source: geo.js=%d, GeoNames kk=%d, fallback to ru=%d' % tuple(
        sum(1 for r in kz if r['kz_src'] == k) for k in ('geo.js', 'kk', 'fallback')))
    log('KZ region: by admin1 code=%d, by nearest neighbours=%d, moved to a 2022 region=%d %s'
        % (region_stat['by_code'], region_stat['by_neighbours'],
           len(region_stat['moved_to_new_region']), region_stat['moved_to_new_region']))
    log('dropped, no Russian name: KZ=%d, foreign=%s'
        % (sum(1 for r in no_ru if r['cc'] == 'KZ'),
           ['%s %s %s' % (r['id'], r['cc'], r['en']) for r in no_ru if r['cc'] != 'KZ']))
    log('dropped as duplicates: KZ=%d, foreign=%s'
        % (sum(1 for r in dropped if r['cc'] == 'KZ'),
           ['%s %s' % (r['id'], r['ru']) for r in dropped if r['cc'] != 'KZ']))
    for table, src in (('NAME_FIX', NAME_FIX), ('EN_FIX', EN_FIX), ('POP_FIX', POP_FIX), ('EXCLUDE', EXCLUDE)):
        absent = sorted(g for g in src if g not in seen_gids)
        log('%s: %d entries, applied=%d, skipped (unexpected GeoNames value)=%d %s, not in selection=%d %s'
            % (table, len(src), len(fix_log[table]['applied']), len(fix_log[table]['mismatch']),
               fix_log[table]['mismatch'] or '', len(absent), absent or ''))
    log('written', out_path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
