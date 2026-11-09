// Fictional sample letters. Every name, address and number here is invented.

export interface Sample {
  id: string;
  label: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: "eviction",
    label: "Eviction notice (fictional)",
    text: `NOTICE TO PAY RENT OR QUIT

To: Maria Elena Lopez
1427 Maple Avenue, Apt 3B
Oakridge, CA 94110

Tenant Account No: 88-1234-77

Dear Maria Elena Lopez,

You are hereby notified that rent for the premises at 1427 Maple Avenue, Apt 3B is past due in the amount of $2,180.00 for the period of October 1 through October 31.

Within THREE (3) days after service of this notice, excluding weekends and court holidays, you are required to pay the amount due in full or deliver up possession of the premises. If you fail to do so, legal proceedings will be instituted against you to recover possession, declare the forfeiture of the rental agreement, and recover rents, damages and court costs.

Payment may be delivered to Greenline Property Management, 500 Harbor Blvd, Suite 210, Oakridge, CA 94111, Monday to Friday 9am-5pm, or by calling (415) 555-0198.

Date of service: November 6

Signed,
Daniel Okafor
Property Manager, Greenline Property Management
d.okafor@greenline-pm.example`,
  },
  {
    id: "insurance",
    label: "Insurance claim denial (fictional)",
    text: `Northbridge Health Plan
Claims Department

Member: James T. Whitaker
Member ID: NBH-55302917
Date of birth: 04/12/1986
Claim number: CLM-2026-0088314

Dear Mr. Whitaker,

We have reviewed the claim submitted by Riverside Imaging Center for an MRI of the lumbar spine performed on September 18. After review, this claim has been DENIED.

Reason: Prior authorization was not obtained before the service was performed, as required under Section 4.2 of your plan documents. The billed amount of $3,450.00 is not covered.

You have the right to appeal this decision. Your appeal must be received within 180 days of the date of this letter. You may submit additional information, such as a letter from your physician explaining the medical necessity of the service. You may also request an external review if your appeal is denied.

To appeal, write to Northbridge Health Plan Appeals, PO Box 4410, Lakeview, IL 60601, or call Member Services at 1-800-555-0142.

Sincerely,
Appeals and Grievances Unit`,
  },
  {
    id: "debt",
    label: "Debt collection letter (fictional)",
    text: `Summit Recovery Partners LLC

Ref: SRP-7781-2290
Original creditor: Coastline Bank Card Services
Card ending: 4111 1111 1111 1111

Dear Priya Natarajan,

Our records show that you owe a balance of $1,912.47 to Coastline Bank Card Services, which has been placed with our office for collection.

Unless you, within thirty days after receipt of this notice, dispute the validity of the debt or any portion thereof, this office will assume this debt is valid. If you notify this office in writing within the thirty-day period that the debt, or any portion thereof, is disputed, this office will obtain verification of the debt and mail you a copy of such verification.

You may reach us at 1-888-555-0177 or collections@summit-recovery.example. Mail payments to 77 Commerce Way, Dover, DE 19901.

This communication is from a debt collector. This is an attempt to collect a debt and any information obtained will be used for that purpose.

Priya Natarajan
22 Willow Court
Dover, DE 19904`,
  },
];
