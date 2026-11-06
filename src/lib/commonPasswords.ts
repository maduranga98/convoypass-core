// The 200 most common passwords (lowercase), plus a few product-specific ones. A password is refused when its
// lowercase form is in this list. Short entries are kept on purpose: the list stays valid if the minimum length changes.
// Mirrors functions/src/auth/commonPasswords.ts (functions deploy from their own folder). Keep both copies in sync.
export const COMMON_PASSWORDS: readonly string[] = [
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111', '1234567', 'dragon', '123123',
  'baseball', 'abc123', 'football', 'monkey', 'letmein', '696969', 'shadow', 'master', '666666', '123321', 'mustang',
  'michael', '654321', 'superman', '1qaz2wsx', '7777777', '121212', '000000', 'qazwsx', '123qwe', 'killer',
  'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter', 'buster', 'soccer', 'harley', 'batman', 'andrew',
  'tigger', 'sunshine', 'iloveyou', '2000', 'charlie', 'robert', 'thomas', 'hockey', 'ranger', 'daniel', 'starwars',
  'klaster', '112233', 'george', 'computer', 'michelle', 'jessica', 'pepper', '1111', 'zxcvbn', '555555', '11111111',
  '131313', 'freedom', '777777', 'pass', 'maggie', '159753', 'aaaaaa', 'ginger', 'princess', 'joshua', 'cheese',
  'amanda', 'summer', 'love', 'ashley', 'nicole', 'chelsea', 'biteme', 'matthew', 'access', 'yankees', '987654321',
  'dallas', 'austin', 'thunder', 'taylor', 'matrix', 'password1', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'welcome',
  'welcome1', 'admin', 'admin123', 'admin1234', 'qwerty123', '1q2w3e4r', 'q1w2e3r4', 'asdfghjkl', '11223344',
  'abcd1234', 'abcdefgh', 'abc12345', 'iloveyou1', 'sunshine1', 'princess1', 'monkey123', 'dragon123', 'football1',
  'baseball1', 'superman1', 'master123', 'qwertyuiop', '1234567890', 'password12', 'password123', 'password1234',
  'password12345', 'welcome123', 'administrator', 'qwerty1234', 'qwerty12345', 'qwertyuiop1', '1q2w3e4r5t',
  '1q2w3e4r5t6y', 'q1w2e3r4t5', 'asdfghjkl1', 'zxcvbnm123', '1234567891', '12345678910', '0123456789', '9876543210',
  '0987654321', '1122334455', '123456789a', '123456789q', 'a123456789', 'abcdefghij', 'letmein123', 'iloveyou123',
  'changeme123', 'convoypass', 'convoypass1', 'convoypass123', 'gatepass123', 'srilanka123', 'colombo123',
  '1111111111', '2222222222', '1231231234', 'aaaaaaaaaa', 'zzzzzzzzzz', '0000000000', '5555555555', '1234qwerty',
  '1qaz2wsx3edc', 'facebook123', 'whatsapp123', 'samsung123', 'testing123', 'test123456', 'secret1234', 'default123',
  'letmein1234', 'pass123456', 'password01', 'password99', 'passwordpassword', 'mypassword', 'mypassword1',
  'mypassword123', 'football123', 'liverpool1', 'chelsea123', 'arsenal123', 'cricket123', 'cricket1234',
  'loveyou123', 'whatever123', 'trustno1234', 'bismillah123', 'godisgood123', 'jesus123456', 'blessed123',
  'nothing123', 'summer2024', 'summer2025', 'winter2024', 'winter2025', 'welcome2024', 'welcome2025', 'password2024',
  'password2025', 'january2025',
]

const COMMON = new Set(COMMON_PASSWORDS)
export const isCommonPassword = (password: string): boolean => COMMON.has(password.trim().toLowerCase())
