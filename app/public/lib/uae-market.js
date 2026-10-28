// Dubai Financial Market (DFM), as Yahoo symbols (CODE.AE), with Arabic short names and sectors.
// From digrin.com's DFM list (Oct 2026); funds, REITs and the Kuwaiti and Sudanese cross-listings left
// out. Abu Dhabi (ADX) isn't carried by Yahoo any more, so it isn't here.
const LIST = `EMAAR|Emaar Properties|إعمار العقارية|عقار
EMAARDEV|Emaar Development|إعمار للتطوير|عقار
DEYAAR|Deyaar|ديار للتطوير|عقار
UPP|Union Properties|الاتحاد العقارية|عقار
ALFIRDOUS|Al Firdous Holdings|الفردوس القابضة|عقار
TECOM|TECOM Group|تيكوم|عقار
DIC|Dubai Investments|دبي للاستثمار|استثمار
EMIRATESNBD|Emirates NBD|الإمارات دبي الوطني|بنوك
DIB|Dubai Islamic Bank|دبي الإسلامي|بنوك
CBD|Commercial Bank of Dubai|دبي التجاري|بنوك
MASQ|Mashreq|بنك المشرق|بنوك
AJMANBANK|Ajman Bank|مصرف عجمان|بنوك
EIBANK|Emirates Investment Bank|الإمارات للاستثمار|بنوك
SALAM_BAH|Al Salam Bank|بنك السلام|بنوك
GFH|GFH Financial|جي إف إتش|خدمات مالية
ITHMR|Ithmaar Holding|إثمار القابضة|خدمات مالية
DFM|Dubai Financial Market|سوق دبي المالي|خدمات مالية
ALANSARI|Al Ansari Financial|الأنصاري للخدمات المالية|خدمات مالية
AMLAK|Amlak Finance|أملاك للتمويل|خدمات مالية
SHUAA|SHUAA Capital|شعاع كابيتال|خدمات مالية
ALRAMZ|Al Ramz|الرمز كابيتال|خدمات مالية
BHMCAPITAL|BHM Capital|بي إتش إم كابيتال|خدمات مالية
AMANAT|Amanat Holdings|أمانات القابضة|خدمات مالية
AMAN|Aman Insurance|أمان للتأمين|تأمين
DIN|Dubai Insurance|دبي للتأمين|تأمين
DNIR|Dubai National Insurance|دبي الوطنية للتأمين|تأمين
NGI|National General Insurance|الوطنية للتأمينات العامة|تأمين
SALAMA|Salama|سلامة|تأمين
SUKOON|Sukoon Insurance|سكون للتأمين|تأمين
SUKOONTAKAFL|Sukoon Takaful|سكون تكافل|تأمين
TAKAFUL-EM|Takaful Emarat|تكافل الإمارات|تأمين
DEWA|DEWA|كهرباء ومياه دبي (ديوا)|مرافق
EMPOWER|Empower|إمباور|مرافق
TABREED|Tabreed|تبريد|مرافق
ETIHADENERGY|Etihad Energy Holding|الاتحاد للطاقة القابضة|مرافق
SALIK|Salik|سالك|نقل
PARKIN|Parkin|باركن|نقل
DTC|Dubai Taxi|دبي للتاكسي|نقل
AIRARABIA|Air Arabia|العربية للطيران|نقل
ARMX|Aramex|أرامكس|نقل
GULFNAV|Gulf Navigation|الخليج للملاحة|نقل
DU|du|دو|اتصالات
TALABAT|Talabat|طلبات|استهلاكي
SPINNEYS|Spinneys|سبينيس|استهلاكي
UNIONCOOP|Union Coop|تعاونية الاتحاد|استهلاكي
TAALEEM|Taaleem|تعليم القابضة|استهلاكي
DRC|Dubai Refreshment|دبي للمرطبات|أغذية
ERC|Emirates Refreshments|الإمارات للمرطبات|أغذية
UFC|United Foods|الأغذية المتحدة|أغذية
UNIKAI|Unikai Foods|يونيكاي|أغذية
WATANIA|Watania|وطنية|أغذية
NAHO|Naeem Holding|نعيم القابضة|خدمات مالية
NCC|National Cement|الإسمنت الوطنية|صناعة
ALEC|ALEC Holdings|ألك القابضة|صناعة
DSI|Drake & Scull|دريك آند سكل|صناعة
MKHZN|Makhazen|مخازن|عقار`;

export const UAE_STOCKS = LIST.split("\n").map((l) => {
  const [code, en, ar, sector] = l.split("|");
  return { code, symbol: `YAHOO:${code}.AE`, en, ar, sector, market: "ae" };
});
