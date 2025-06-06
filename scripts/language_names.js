/* Downloads the latest translations from Transifex */
const fs = require('fs');

const cldrMainDir = 'node_modules/cldr-localenames-full/main/';
const rematchCodes = {
  'ar-AA': 'ar',
  'pt-BR': 'pt',
  'pt': 'pt-PT',
  'zh-CN': 'zh',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant-HK'
};

const codesToSkip = ['ase', 'mis', 'mul', 'und', 'zxx'];

let referencedScripts = [];

/**
 * @returns {{
 *  [code: string]: {
 *    base?: string;
 *    script?: string;
 *    nativeName?: string;
 *    names?: { [code: string]: string };
 *  }
 * }}
 */
function getCLDROverrides() {
  // manually add languages we want that aren't in CLDR
  // see for example https://github.com/openstreetmap/iD/pull/9241/
  return {
    aer: { nativeName: 'Arrernte' },
    aoi: { nativeName: 'Anindilyakwa' },
    aus: { nativeName: 'Australian Aboriginal Languages' },
    bdy: { nativeName: 'Yugambeh–Bandjalangic' },
    'bft': {
      nativeName: 'بلتی'
    },
    'bha': {
      nativeName: 'भरीयाटी'
    },
    'brh': {
      nativeName: 'براہوئی'
    },
    coa: { nativeName: 'Basa Pulu Kokos', names: { en: 'Cocos Malay' } },
    'cdo': {
      nativeName: '閩東語'
    },
    'cdo-Hans': {
      base: 'cdo',
      script: 'Hans',
      nativeName: '闽东语（简化汉字）'
    },
    'cdo-Hant': {
      base: 'cdo',
      script: 'Hant',
      nativeName: '閩東語（傳統漢字）'
    },
    'cdo-Latn': {
      base: 'cdo',
      script: 'Latn',
      nativeName: 'Mìng-dĕ̤ng-ngṳ̄ (Bàng-uâ-cê)'
    },
    'cpx': {
      nativeName: '莆仙語'
    },
    'cpx-Hans': {
      base: 'cpx',
      script: 'Hans',
      nativeName: '莆仙语（简体）'
    },
    'cpx-Hant': {
      base: 'cpx',
      script: 'Hant',
      nativeName: '莆仙語（繁體）'
    },
    'cpx-Latn': {
      base: 'cpx',
      script: 'Latn',
      nativeName: 'Pó-sing-gṳ̂ (Báⁿ-uā-ci̍)'
    },
    dgw: { nativeName: 'Daungwurrung' },
    'gan': {
      nativeName: '贛語'
    },
    'gan-Hans': {
      base: 'gan',
      script: 'Hans',
      nativeName: '赣语（简体）'
    },
    'gan-Hant': {
      base: 'gan',
      script: 'Hant',
      nativeName: '贛語（繁體）'
    },
    gjm: { nativeName: 'Gunditjmara' },
    gjr: { nativeName: 'Gurindji Kriol' },
    gup: { nativeName: 'Bininj Gun-Wok' },
    'hak': {
      nativeName: '客家語'
    },
    'hak-Hans': {
      base: 'hak',
      script: 'Hans',
      nativeName: '客家语（简体）'
    },
    'hak-Hant': {
      base: 'hak',
      script: 'Hant',
      nativeName: '客家語（繁體）'
    },
    'hak-Latn': {
      base: 'hak',
      script: 'Latn',
      nativeName: 'Hak-kâ-ngî (Pha̍k-fa-sṳ)'
    },
    'hsn': {
      nativeName: '湘語'
    },
    'ja-Hira': {
      base: 'ja',
      script: 'Hira'
    },
    'ja-Latn': {
      base: 'ja',
      script: 'Latn'
    },
    jay: { nativeName: 'Yan-nhaŋu' },
    'kls': {
      nativeName: 'Kal\'as\'amondr'
    },
    'ko-Latn': {
      base: 'ko',
      script: 'Latn'
    },
    'mnc-Latn': {
      base: 'mnc',
      script: 'Latn',
      nativeName: 'manju gisun'
    },
    'mnc-Mong': {
      base: 'mnc',
      script: 'Mong',
      nativeName: 'ᠮᠠᠨᠵᡠ ᡤᡳᠰᡠᠨ'
    },
    mwf: { nativeName: 'Murrinh-Patha' },
    mwp: { nativeName: 'Kalaw Lagaw Ya' },
    'nan': {
      nativeName: '閩南語'
    },
    'nan-Hant': {
      base: 'nan',
      script: 'Hant',
      nativeName: '閩南語（傳統漢字）'
    },
    'nan-Latn-pehoeji': {
      base: 'nan',
      script: 'Latn',
      nativeName: 'Bân-lâm-gú (Pe̍h-ōe-jī)'
    },
    'nan-Latn-tailo': {
      base: 'nan',
      script: 'Latn',
      nativeName: 'Bân-lâm-gú (Tâi-lô)'
    },
    nys: { nativeName: 'Nyungar' },
    'oc': {
      nativeName: 'Occitan'
    },
    pih: { nativeName: 'Pitkern–Norfuk', names: { en: 'Pitcairn-Norfolk', ty: 'Pitcairnais' } },
    piu: { nativeName: 'Pintupi' },
    pjt: { nativeName: 'Pitjantjatjara' },
    'pnb': {
      nativeName: 'پنجابی'
    },
    rop: { nativeName: 'Australian Kriol' },
    rrm: { nativeName: 'Moriori' },
    'scl': {
      nativeName: 'ݜݨیاٗ'
    },
    'shg': {
      nativeName: 'хуг̌ну̊н зив'
    },
    'skr': {
      nativeName: 'سرائیکی'
    },
    tcs: { nativeName: 'Yumplatok', names: { en: 'Torres Strait Creole' } },
    tiw: { nativeName: 'Tiwi' },
    'trw': {
      nativeName: 'توروالی'
    },
    ulk: { nativeName: 'Meriam Mir' },
    'wbl': {
      nativeName: 'وخی'
    },
    wlp: { nativeName: 'Warlpiri' },
    'wuu': {
      nativeName: '吳語'
    },
    'wuu-Hans': {
      base: 'wuu',
      script: 'Hans',
      nativeName: '吴语（简体）'
    },
    'wuu-Hant': {
      base: 'wuu',
      script: 'Hant',
      nativeName: '吳語（正體）'
    },
    wrh: { nativeName: 'Wiradjuri' },
    wth: { nativeName: 'Wathawurrung' },
    wyi: { nativeName: 'Woiwurrung' },
    xdk: { nativeName: 'Dharug' },
    xni: { nativeName: 'Ngarigo' },
    xph: { nativeName: 'Tyerrernotepanner', names: { en: 'North Midlands Tasmanian' } },
    xrd: { nativeName: 'Gundungurra' },
    'yue-Hans': {
      base: 'yue',
      script: 'Hans',
      nativeName: '粵语（简体）'
    },
    'yue-Hant': {
      base: 'yue',
      script: 'Hant',
      nativeName: '粵語（繁體）'
    },
    'zh-Latn-pinyin': {
      base: 'zh',
      script: 'Latn',
      nativeName: 'Zhōngwén (Hànyǔ Pīnyīn)'
    },
    zku: { nativeName: 'Kaurna' },
  };
}

function getLangNamesInNativeLang() {
  const unordered = getCLDROverrides();
  for (const key in unordered) {
    delete unordered[key].names; // this is added later
  }

  let langDirectoryPaths = fs.readdirSync(cldrMainDir);
  langDirectoryPaths.forEach(code => {
    let languagesPath = `${cldrMainDir}${code}/languages.json`;
    if (!fs.existsSync(languagesPath)) return;
    let languageObj = JSON.parse(fs.readFileSync(languagesPath, 'utf8')).main[code];
    let identity = languageObj.identity;

    // skip locale-specific languages
    if (identity.letiant || identity.territory) return;

    let info = {};
    const script = identity.script;
    if (script) {
      referencedScripts.push(script);
      info.base = identity.language;
      info.script = script;
    }

    const nativeName = languageObj.localeDisplayNames.languages[code];
    if (nativeName) {
      info.nativeName = nativeName;
    }

    unordered[code] = info;
  });

  // CLDR locales don't cover all the languages people might want to use for iD tags,
  // so also add the language names that we have English translations for
  let englishNamesByCode = JSON.parse(fs.readFileSync(`${cldrMainDir}en/languages.json`, 'utf8')).main.en.localeDisplayNames.languages;
  Object.keys(englishNamesByCode).forEach(code => {
    if (code in unordered) return;
    if (code.indexOf('-') !== -1) return;
    if (codesToSkip.indexOf(code) !== -1) return;
    unordered[code] = {};
  });

  // delete codes which should not be used
  delete unordered['pa-Arab']; // https://github.com/openstreetmap/iD/pull/9241/
  delete unordered['pa-Guru']; // - " -

  let ordered = {};
  Object.keys(unordered).sort().forEach(key => ordered[key] = unordered[key]);
  return ordered;
}

const langNamesInNativeLang = getLangNamesInNativeLang();

exports.langNamesInNativeLang = langNamesInNativeLang;

exports.languageNamesInLanguageOf = function(code) {
  if (rematchCodes[code]) code = rematchCodes[code];

  const { language } = new Intl.Locale(code);

  let languageFilePath = `${cldrMainDir}${code}/languages.json`;
  if (!fs.existsSync(languageFilePath)) return null;

  let translatedLangsByCode = JSON.parse(fs.readFileSync(languageFilePath, 'utf8')).main[code].localeDisplayNames.languages;

  // add any overrides that have translated names
  for (const [key, value] of Object.entries(getCLDROverrides())) {
    if (value.names?.[language]) {
      translatedLangsByCode[key] ||= value.names?.[language];
    }
  }

  // ignore codes for non-languages
  codesToSkip.forEach(skipCode => {
    delete translatedLangsByCode[skipCode];
  });

  for (let langCode in translatedLangsByCode) {
    let altLongIndex = langCode.indexOf('-alt-long');
    if (altLongIndex !== -1) {    // prefer long names (e.g. Chinese -> Mandarin Chinese)
      let base = langCode.substring(0, altLongIndex);
      translatedLangsByCode[base] = translatedLangsByCode[langCode];
    }

    if (langCode.includes('-alt-')) {
      // remove alternative names
      delete translatedLangsByCode[langCode];
    } else if (langCode === translatedLangsByCode[langCode]) {
      // no localized value available
      delete translatedLangsByCode[langCode];
    } else if (!langNamesInNativeLang[langCode]){
      // we don't need to include language names that we probably won't be showing in the UI
      delete translatedLangsByCode[langCode];
    }
  }

  return translatedLangsByCode;
};


exports.scriptNamesInLanguageOf = function(code) {
  if (rematchCodes[code]) code = rematchCodes[code];

  let languageFilePath = `${cldrMainDir}${code}/scripts.json`;
  if (!fs.existsSync(languageFilePath)) return null;

  let allTranslatedScriptsByCode = JSON.parse(fs.readFileSync(languageFilePath, 'utf8')).main[code].localeDisplayNames.scripts;

  let translatedScripts = {};
  referencedScripts.forEach(script => {
    if (!allTranslatedScriptsByCode[script] || script === allTranslatedScriptsByCode[script]) return;
    translatedScripts[script] = allTranslatedScriptsByCode[script];
  });

  return translatedScripts;
};
