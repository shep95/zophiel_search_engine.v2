export interface InPageTextBlock {
  text: string;
  selector: string;
  visible: boolean;
  prominence: number;
  source: 'dom' | 'css-pseudo' | 'shadow-dom' | 'js-embedded' | 'meta';
}

export interface InPageCssIntel {
  stylesheetUrls: string[];
  inlineStyleBytes: number;
  hiddenRuleCount: number;
  hiddenSelectors: string[];
  pseudoTexts: string[];
  fontSizeSamples: number[];
}

export interface InPageJsIntel {
  scriptUrls: string[];
  inlineScriptCount: number;
  libraries: string[];
  embeddedPayloads: Array<{ source: string; preview: string }>;
  jsonLdBlocks: string[];
  isSpa: boolean;
}

export interface InPageExtraction {
  textBlocks: InPageTextBlock[];
  css: InPageCssIntel;
  js: InPageJsIntel;
  links: string[];
}
