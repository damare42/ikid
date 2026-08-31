/**
 * Default categories and categorization rules seeded on first run.
 * Rules include generic bank keywords plus real-world merchant rules
 * (imported from prior statement analysis) so imports categorize well out of the box.
 */

export interface DefaultCategory {
  name: string;
  type: "expense" | "income" | "transfer";
  color: string;
}

/**
 * Category colours.
 *
 * Every hue here is the one originally chosen; several have been darkened or
 * lightened, and nothing else about them changed. The originals were stock
 * Tailwind hues, which are not accessible colours — measured on the live
 * dashboard, Transportation rendered at 2.15:1 and Groceries at 2.28:1, and
 * a category dot on its own 13% tint came out as low as 2.42:1.
 *
 * Each colour now clears 3:1 (WCAG 1.4.11, graphical objects) four ways: on
 * white, on the dark panel, and as a dot on its own tint over each. Pinned by
 * server/src/tests/contrast.test.ts.
 *
 * These are defaults, not rules. A user can pick any colour they like, which is
 * exactly why `Badge` puts the colour in the dot and leaves the label in body
 * text — no palette can guarantee a colour someone else chose is readable.
 */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Housing", type: "expense", color: "#8b5cf6" },
  { name: "Utilities", type: "expense", color: "#0c8fca" },
  { name: "Internet", type: "expense", color: "#0595ae" },
  { name: "Phone", type: "expense", color: "#109889" },
  { name: "Transportation", type: "expense", color: "#ba7808" },
  { name: "Insurance", type: "expense", color: "#64748b" },
  { name: "Health", type: "expense", color: "#ef4444" },
  { name: "Dining", type: "expense", color: "#e05f06" },
  { name: "Coffee", type: "expense", color: "#a66507" },
  { name: "Groceries", type: "expense", color: "#1b9d4b" },
  { name: "Shopping", type: "expense", color: "#ec4698" },
  { name: "Entertainment", type: "expense", color: "#d73fee" },
  { name: "Subscriptions", type: "expense", color: "#6366f1" },
  { name: "Travel", type: "expense", color: "#3b82f6" },
  { name: "Fees & Charges", type: "expense", color: "#78716c" },
  { name: "Gifts & Charity", type: "expense", color: "#e11d48" },
  { name: "Taxes", type: "expense", color: "#816e6e" },
  { name: "Investment", type: "expense", color: "#0d9b6c" },
  { name: "Salary", type: "income", color: "#159d47" },
  { name: "Other Income", type: "income", color: "#629810" },
  { name: "Savings", type: "transfer", color: "#0d9488" },
  { name: "Transfers", type: "transfer", color: "#788ba5" },
  { name: "Unknown", type: "expense", color: "#808999" },
];

/** keyword -> category name. Matching is case-insensitive substring. */
export const DEFAULT_RULES: [string, string][] = [
  // Housing
  ["MORTGAGE", "Housing"],
  ["RENT", "Housing"],
  ["APARTMENT", "Housing"],
  ["CORTLAND", "Housing"],
  ["MOVINGHELP.COM", "Housing"],
  ["U-HAUL", "Housing"],
  // Utilities
  ["GEORGIA POWER", "Utilities"],
  ["GA NATGAS", "Utilities"],
  ["ELECTRIC", "Utilities"],
  ["WATER UTIL", "Utilities"],
  ["GAS SOUTH", "Utilities"],
  // Internet / Phone
  ["COMCAST", "Internet"],
  ["XFINITY", "Internet"],
  ["AT&T INTERNET", "Internet"],
  ["SPECTRUM", "Internet"],
  ["T-MOBILE", "Phone"],
  ["VERIZON", "Phone"],
  ["MINT MOBILE", "Phone"],
  // Transportation
  ["CHEVRON", "Transportation"],
  ["SHELL OIL", "Transportation"],
  ["EXXON", "Transportation"],
  ["QT ", "Transportation"],
  ["RACETRAC", "Transportation"],
  ["UBER", "Transportation"],
  ["LYFT", "Transportation"],
  ["MARTA", "Transportation"],
  ["PARKING", "Transportation"],
  ["LAZ PARKING", "Transportation"],
  ["LEGACY PARKING", "Transportation"],
  ["AAA PARK", "Transportation"],
  ["CAR WASH", "Transportation"],
  ["AUTO SPA", "Transportation"],
  ["CAR SPA", "Transportation"],
  ["QUICK TUNE LUBE", "Transportation"],
  ["ATLANTA AIRPORT", "Transportation"],
  ["DEKALB MVD", "Fees & Charges"],
  // Insurance
  ["STATE FARM", "Insurance"],
  ["GEICO", "Insurance"],
  ["PROGRESSIVE", "Insurance"],
  ["ALLSTATE", "Insurance"],
  // Health
  ["CVS/PHARMACY", "Health"],
  ["WALGREENS", "Health"],
  ["PHARMACY", "Health"],
  ["MEDICAL", "Health"],
  ["MEND PRIMARY CARE", "Health"],
  ["LABORATORY CORPORATION", "Health"],
  ["LAUREATE MEDICAL", "Health"],
  ["WOOLFSON EYE", "Health"],
  ["DENTAL", "Health"],
  ["KAISER", "Health"],
  // Coffee
  ["STARBUCKS", "Coffee"],
  ["DUNKIN", "Coffee"],
  ["CARIBOU COFFEE", "Coffee"],
  ["GORIN'S CAFE", "Coffee"],
  // Dining
  ["RESTAURANT", "Dining"],
  ["DOORDASH", "Dining"],
  ["GRUBHUB", "Dining"],
  ["UBER EATS", "Dining"],
  ["CHIPOTLE", "Dining"],
  ["CHICK-FIL-A", "Dining"],
  ["TACO BELL", "Dining"],
  ["POPEYES", "Dining"],
  ["SHAKE SHACK", "Dining"],
  ["MCDONALD", "Dining"],
  ["WENDY'S", "Dining"],
  ["CAFE INTERMEZZO", "Dining"],
  ["ECLIPSE DI LUNA", "Dining"],
  ["GORINA'S GALLERIA", "Dining"],
  ["NORTH ITALIA", "Dining"],
  ["RUMIS KITCHEN", "Dining"],
  ["FOODA", "Dining"],
  ["LEDET RESTAURANT", "Dining"],
  ["BARCELONA", "Dining"],
  ["TASSILI", "Dining"],
  ["MESKEL ETHIOPIAN", "Dining"],
  ["SWEET HUT BAKERY", "Dining"],
  ["MAPLE STREET BISCUIT", "Dining"],
  ["QUEEN SHEBA BAKERY", "Dining"],
  ["RREAL TACOS", "Dining"],
  ["PONKO CHICKEN", "Dining"],
  ["MELLOW MUSHROOM", "Dining"],
  ["CAVA", "Dining"],
  ["VELVET TACO", "Dining"],
  ["TACO MAC", "Dining"],
  ["TIN DRUM", "Dining"],
  ["TINDRUM", "Dining"],
  ["SHOA RESTAURANT", "Dining"],
  ["TOP SPICE", "Dining"],
  ["PHO DAKAO", "Dining"],
  ["FARM BURGER", "Dining"],
  ["KALE ME CRAZY", "Dining"],
  ["TROPICAL SMOOTHIE", "Dining"],
  ["LONGHORN", "Dining"],
  ["CHILI'S", "Dining"],
  ["T.G.I. FRIDAY", "Dining"],
  ["DWARF HOUSE", "Dining"],
  ["KILWINS", "Dining"],
  ["JEREMIAH'S ICE", "Dining"],
  ["VOGA ITALIAN GELATO", "Dining"],
  // Groceries
  ["MALEDA MARKET", "Groceries"],
  ["KROGER", "Groceries"],
  ["PUBLIX", "Groceries"],
  ["WM SUPERCENTER", "Groceries"],
  ["WAL-MART", "Groceries"],
  ["WALMART", "Groceries"],
  ["SAMS CLUB", "Groceries"],
  ["SAMSCLUB", "Groceries"],
  ["ELSA FOOD MART", "Groceries"],
  ["BALAGERU FOOD MART", "Groceries"],
  ["RUTA CULTURAL FOOD", "Groceries"],
  ["DOLLAR TREE", "Groceries"],
  ["FAMILY DOLLAR", "Groceries"],
  ["ALDI", "Groceries"],
  ["TRADER JOE", "Groceries"],
  ["WHOLE FOODS", "Groceries"],
  ["COSTCO", "Groceries"],
  ["FOOD MART", "Groceries"],
  // Shopping
  ["AMAZON", "Shopping"],
  ["AMZN", "Shopping"],
  ["TARGET", "Shopping"],
  ["ZARA", "Shopping"],
  ["ROSS STORES", "Shopping"],
  ["T.J. MAXX", "Shopping"],
  ["MARSHALLS", "Shopping"],
  ["BURLINGTON", "Shopping"],
  ["DSW", "Shopping"],
  ["WAYFAIR", "Shopping"],
  ["HOME DEPOT", "Shopping"],
  ["LOWE'S", "Shopping"],
  ["IKEA", "Shopping"],
  ["BEST BUY", "Shopping"],
  // Entertainment
  ["IPIC", "Entertainment"],
  ["STUDIO MOVIE GRILL", "Entertainment"],
  ["AMC ", "Entertainment"],
  ["REGAL", "Entertainment"],
  ["TICKETMASTER", "Entertainment"],
  ["SMP - TICKETS", "Entertainment"],
  ["STEAM", "Entertainment"],
  ["PLAYSTATION", "Entertainment"],
  ["NINTENDO", "Entertainment"],
  // Subscriptions
  ["NETFLIX", "Subscriptions"],
  ["SPOTIFY", "Subscriptions"],
  ["HULU", "Subscriptions"],
  ["DISNEY PLUS", "Subscriptions"],
  ["APPLE.COM", "Subscriptions"],
  ["YOUTUBE PREMIUM", "Subscriptions"],
  ["HBO MAX", "Subscriptions"],
  ["AUDIBLE", "Subscriptions"],
  ["ICLOUD", "Subscriptions"],
  // Travel
  ["DELTA AIR", "Travel"],
  ["UNITED AIR", "Travel"],
  ["ETHIOPIAN AI", "Travel"],
  ["AIRBNB", "Travel"],
  ["MARRIOTT", "Travel"],
  ["HILTON", "Travel"],
  ["HOTEL", "Travel"],
  ["EXPEDIA", "Travel"],
  ["SUPER.COM", "Travel"],
  ["WIZFAIR", "Travel"],
  ["BOOKING.COM", "Travel"],
  // Fees / Taxes
  ["OVERDRAFT", "Fees & Charges"],
  ["SERVICE FEE", "Fees & Charges"],
  ["ATM FEE", "Fees & Charges"],
  ["LATE FEE", "Fees & Charges"],
  ["FREETAXUSA", "Taxes"],
  ["IRS ", "Taxes"],
  ["TURBOTAX", "Taxes"],
  // Gifts & Charity
  ["ETHIOPIAN COMMUNITY ASSO", "Gifts & Charity"],
  ["DEBRE BISRAT", "Gifts & Charity"],
  ["GOFUNDME", "Gifts & Charity"],
  ["DONATION", "Gifts & Charity"],
  // Income
  ["PAYROLL", "Salary"],
  ["DIRECT DEP", "Salary"],
  ["SALARY", "Salary"],
  ["TAX REFUND", "Other Income"],
  ["INTEREST PAYMENT", "Other Income"],
  ["INTEREST EARNED", "Other Income"],
  ["CASHBACK", "Other Income"],
  // Investment
  ["VANGUARD", "Investment"],
  ["FIDELITY", "Investment"],
  ["ROBINHOOD", "Investment"],
  ["SCHWAB", "Investment"],
  // Transfers / Savings
  ["TRANSFER TO SAVINGS", "Savings"],
  ["ONLINE TRANSFER", "Transfers"],
  ["ZELLE", "Transfers"],
  ["VENMO", "Transfers"],
  ["AUTOPAY", "Transfers"],
  ["PAYMENT THANK YOU", "Transfers"],
  ["CARD PAYMENT", "Transfers"],
  ["ACH PMT", "Transfers"],
];

/** Description keywords that mark a transaction as a transfer (excluded from income/spend).
 *  Includes common credit-card payment formats (Chase, Amex, Discover, Capital One,
 *  Citi, Apple Card) so paying a card bill is never counted as income or spending. */
export const TRANSFER_KEYWORDS = [
  "TRANSFER",
  "AUTOPAY",
  "PAYMENT THANK YOU",
  "THANK YOU-MOBILE",
  "PAYMENT RECEIVED",
  "CARD PAYMENT",
  "CRCARDPMT",
  "CRD EPAY",
  "EPAYMENT",
  "E-PAYMENT",
  "CARDMEMBER SERV",
  "APPLECARD GSBANK",
  "ONLINE PAYMENT TO",
  "ZELLE",
  "VENMO",
  "ACH PMT",
];
