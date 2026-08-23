'use strict';

const { z } = require('zod');

// Minimum age helper
const isAtLeast18 = (val) => {
  const dob = new Date(val);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 18;
};

// Validate future date
const isFutureDate = (val) => {
  const exp = new Date(val);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp > today;
};

const submitVerificationSchema = z.object({
  full_legal_name: z
    .string()
    .min(2, 'Full legal name must be at least 2 characters')
    .max(200)
    .trim(),
  date_of_birth: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), 'Invalid date format')
    .refine(isAtLeast18, 'You must be at least 18 years old to verify'),
  id_type: z.enum(['passport', 'drivers_license', 'state_id'], {
    errorMap: () => ({
      message: 'ID type must be: passport, drivers_license, or state_id',
    }),
  }),
  document_expiration_date: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), 'Invalid date format')
    .refine(isFutureDate, 'Document has already expired'),
});

const reviewVerificationSchema = z
  .object({
    status: z.enum(['approved', 'rejected'], {
      errorMap: () => ({
        message: 'Status must be: approved or rejected',
      }),
    }),
    rejection_reason: z.string().max(500).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.status === 'rejected' && !data.rejection_reason?.trim()) {
        return false;
      }
      return true;
    },
    {
      message: 'Rejection reason is required when status is rejected',
      path: ['rejection_reason'],
    }
  );

module.exports = {
  submitVerificationSchema,
  reviewVerificationSchema,
};
