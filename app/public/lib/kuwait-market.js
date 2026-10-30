// Boursa Kuwait's listed companies (133, Oct 2026, from 6ix.com's KSE list), as Yahoo symbols
// (CODE.KW). Arabic names (the same as lib/gulf.js) where known. A code Yahoo doesn't carry just
// shows as "no data" in the scan.

const LIST = `MARKAZ|Kuwait Financial Centre
JAZEERA|Jazeera Airways
NBK|National Bank of Kuwait
MEZZAN|Mezzan Holding
STC|stc Kuwait
BOURSA|Boursa Kuwait Securities
GBK|Gulf Bank
ZAIN|Zain
HUMANSOFT|Humansoft
SHIP|Heavy Engineering & Shipbuilding
BPCC|Boubyan Petrochemical
ALIMTIAZ|Al Imtiaz Investment
KFH|Kuwait Finance House
MABANEE|Mabanee
MKHZN|Agility Public Warehousing
BOUBYAN|Boubyan Bank
WARBABANK|Warba Bank
AAYAN|A'ayan Leasing & Investment
ATC|Advanced Technology
IFAHR|IFA Hotels & Resorts
NINV|National Investments
AZNOULA|Shamal Az-Zour Al-Oula
GINS|Gulf Insurance Group
JTC|JTC Logistics
ALFTAQA|Action Energy
ALTIJARIA|Commercial Real Estate
CABLE|Gulf Cables
KPROJ|KIPCO
BURG|Burgan Bank
SRE|Salhia Real Estate
INTEGRATED|Integrated Holding
KAMCO|KAMCO Invest
URC|United Real Estate
CGC|Combined Group Contracting
ABK|Al Ahli Bank of Kuwait
BEYOUT|Beyout Holding
CLEANING|National Cleaning
IPG|Independent Petroleum Group
IFA|International Financial Advisors
NIND|National Industries Group
NAPESCO|National Petroleum Services
OSOUL|Osoul Investment
ALKOUT|Al-Kout Industrial Projects
COAST|Coast Investment
KINV|Kuwait Investment Co.
WARBACAP|Warba Capital
AMAR|Amar Finance & Leasing
ARZAN|Arzan Financial Group
ABAR|Burgan Well Drilling
INJAZZAT|Injazzat Real Estate
KBT|Kuwait Business Town
TIJARA|Tijara Real Estate
WINSRE|Warba Insurance
ARKAN|Arkan Al-Kuwait Real Estate
DIGITUS|Digitus Group
ALOLA|First Investment
KRE|Kuwait Real Estate Co.
MARAKEZ|Marakez Real Estate
MUNSHAAT|Munshaat Real Estate
NICBM|National Industries Building Materials
OSOS|Osos Holding
OULAFUEL|Oula Fuel Marketing
TAM|Tamdeen Real Estate
TROLLEY|Trolley General Trading
ACICO|Acico Industries
ALSAFAT|Al Safat Investment
MAZAYA|Al-Mazaya Holding
ALG|Ali Alghanim Sons Automotive
AQAR|Aqar Real Estate
ENERGYH|Energy House Holding
GIH|Gulf Investment House
KFIC|Kfic Invest
KCPC|Process Plant Construction
MRC|Metal & Recycling
PAPCO|Palms Agro Production
RASIYAT|Rasiyat Holding
SENERGY|Senergy Holding
UNICAP|UniCap Investment
AAYANRE|A'ayan Real Estate
AINS|Al-Ahleia Insurance
MIDAN|Al-Maidan Clinic
ARGAN|Alargan International Real Estate
ASC|Automated Systems
CBK|Commercial Bank of Kuwait
FACIL|Commercial Facilities
THURAYA|Dar Al-Thuraya Real Estate
EKTTITAB|Ekttitab Holding
FUTUREKID|Future Kid Entertainment
GFC|Gulf Franchising Holding
KMEFIC|Kuwait & Middle East Financial
KHOT|Kuwait Hotels
KIB|Kuwait International Bank
PCEM|Kuwait Portland Cement
ALAQARIA|Kuwait Real Estate Holding
MUNTAZAHAT|Kuwait Resorts
CATTL|Livestock Transport & Trading
MENA|MENA Real Estate
NCCI|National Consumer Holding
NRE|National Real Estate
SANAM|Sanam Group Holding
NOOR|Noor Financial Investment
SECH|Securities House
TAMINV|Tamdeen Investment
AREEC|Ajial Real Estate Entertainment
MADAR|Al Madar Kuwait Holding
ALMANAR|Al Manar Financing & Leasing
ARABREC|Al-Arabiya Real Estate
ALDEERA|Al-Deera Holding
ASIYA|Asiya Capital
BAYANINV|Bayan Investment Holding
TAHSSILAT|Credit Rating & Collection
EQUIPMENT|Equipment Holding
KCEM|Kuwait Cement
EMIRATES|Kuwait Emirates Holding
KINS|Kuwait Insurance
KCIN|Kuwait National Cinema
KUWAITRE|Kuwait Reinsurance
MANAZEL|Manazel Holding
MASHAER|Mashaer Holding
MUBARRAD|Mubarrad Holding
NIH|National International Holding
OOREDOO|Ooredoo Kuwait
KPPC|Privatization Holding
SOKOUK|Sokouk Holding
SOOR|Soor Fuel Marketing
SPEC|Specialties Group Holding
UPAC|United Projects for Aviation
WETHAQ|Wethaq Takaful
DALQANRE|Dalqan Real Estate
FTI|First Takaful Insurance
ERESCO|Al-Enmaa Real Estate
PAPER|Shuaiba Industrial
GFH|GFH Financial Group`;

const AR = {"NBK": "بنك الكويت الوطني", "KFH": "بيت التمويل الكويتي", "BOUBYAN": "بنك بوبيان", "GBK": "بنك الخليج", "WARBABANK": "بنك وربة", "CBK": "البنك التجاري الكويتي", "ABK": "البنك الأهلي الكويتي", "BURG": "بنك برقان", "KIB": "بنك الكويت الدولي", "ZAIN": "زين", "OOREDOO": "أريدو", "STC": "إس تي سي", "MABANEE": "المباني", "KRE": "عقارات الكويت", "URC": "المتحدة العقارية", "AGLTY": "أجيليتي", "HUMANSOFT": "هيومن سوفت", "BOURSA": "بورصة الكويت", "NIND": "مجموعة الصناعات الوطنية", "KPROJ": "مشاريع الكويت", "JAZEERA": "طيران الجزيرة", "MEZZAN": "ميزان", "GINS": "الخليج للتأمين", "BPCC": "بوبيان للبتروكيماويات", "ALG": "علي الغانم", "CABLE": "الخليج للكابلات", "GFH": "جي إف إتش", "ALSAFAT": "الصفاة للاستثمار"};

export const KUWAIT_STOCKS = LIST.split("\n").map((line) => {
  const [code, en] = line.split("|");
  return { code, symbol: `YAHOO:${code}.KW`, en, ar: AR[code] || null };
});
