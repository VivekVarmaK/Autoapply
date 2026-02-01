export type AtsType = "greenhouse" | "lever" | "ashby";

export interface JobRecord {
  id: string;
  company: string;
  title: string;
  location: string;
  ats: AtsType;
  applyUrl: string;
  companySlug?: string;
  department?: string;
}

export interface CompanyRegistryEntry {
  name: string;
  ats: AtsType;
  slug: string;
}
