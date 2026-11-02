import type { Institution } from "./types";

/**
 * The verified-institution registry. In production this would come from bank
 * KYB data and the institution's own confirmation; in the sandbox both
 * institutions are fictional.
 */
export const INSTITUTIONS: Record<string, Institution> = {
  srh: {
    id: "srh",
    kind: "hospital",
    name: "Siam Riverside International Hospital",
    legalName: "Siam Riverside Hospital Co., Ltd.",
    country: "Thailand",
    city: "Bangkok",
    email: "international@siamriverside.co.th",
    emailDomain: "siamriverside.co.th",
    bank: {
      bankName: "Bangkok Commercial Bank",
      accountName: "Siam Riverside Hospital Co., Ltd.",
      accountNumber: "101-3-58821-7",
      swift: "BKCBTHBK",
      currency: "THB",
    },
    referenceRule: { label: "Patient hospital number (HN)", pattern: "HN\\s?\\d{2}-\\d{6}" },
    acceptsCards: true,
  },
  kgu: {
    id: "kgu",
    kind: "university",
    name: "Kingsgate University London",
    legalName: "Kingsgate University",
    country: "United Kingdom",
    city: "London",
    email: "student.finance@kingsgate.ac.uk",
    emailDomain: "kingsgate.ac.uk",
    bank: {
      bankName: "Thameside Bank plc",
      accountName: "Kingsgate University",
      accountNumber: "GB29 TSBK 6016 1331 9268 19",
      swift: "TSBKGB2L",
      currency: "GBP",
    },
    referenceRule: { label: "Student ID", pattern: "KG\\d{7}" },
    students: [{ id: "KG2601847", name: "Lin Yuxuan", programme: "MSc Data Science", start: "18 January 2027" }],
    acceptsCards: true,
    cardSurchargePct: 0.025,
  },
};
