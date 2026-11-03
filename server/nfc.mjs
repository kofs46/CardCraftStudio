import { ApiError } from './supabase.mjs';
export const isNfc = p => p?.id === 'premium-nfc' || p?.customization === 'nfc';
export function nfcDetails(raw = {}) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('Invalid NFC details.');
 const result = {};
 for (const [key,max] of Object.entries({displayName:120,title:150,company:150,phone:40,email:254,bio:1500,other:3000})) {
  if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new ApiError('Invalid NFC details.');
  result[key] = (raw[key] || '').trim();
  if (result[key].length > max) throw new ApiError('NFC information is too long.');
 }
 if (!result.displayName) throw new ApiError('NFC কার্ডে প্রদর্শনের নাম দিন।');
 if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new ApiError('NFC প্রোফাইলের সঠিক ইমেইল দিন।');
 for (const key of ['facebook','instagram','youtube','linkedin','website']) {
  const value = raw[key];
  if (value !== undefined && typeof value !== 'string') throw new ApiError('Invalid NFC link.');
  if (!value?.trim()) { result[key] = ''; continue; }
  try {
   const link = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim());
   if (!['http:','https:'].includes(link.protocol) || link.username || link.password || !link.hostname.includes('.') || value.length > 1000) throw Error();
   result[key] = link.href;
  } catch { throw new ApiError('NFC লিংক সঠিকভাবে লিখুন, যেমন https://facebook.com/yourpage'); }
 }
 return result;
}
