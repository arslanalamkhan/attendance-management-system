/**
 * Bundled list of very common passwords (lower-case). Passwords are compared case-insensitively and also after
 * stripping trailing digits/symbols and common leetspeak, so "Password123!" is rejected because of "password".
 * Roughly 1,000 entries: the literal list below plus generated suffix variants of the most common bases.
 */
const RAW = `
password 123456 12345678 123456789 12345 1234567 1234567890 qwerty abc123 111111 123123 password1 iloveyou
1q2w3e4r 000000 qwerty123 zaq12wsx dragon sunshine princess letmein monkey 654321 football 123321 master
login welcome admin admin123 root toor passw0rd p@ssw0rd p@ssword password123 password12 password1234 pass123
test123 test1234 changeme secret trustno1 baseball superman michael shadow ashley jessica michelle charlie
jordan hunter harley ranger buster thomas tigger robert soccer batman killer hockey george andrew freedom
whatever computer internet starwars cheese pepper summer winter spring autumn flower orange banana cookie
chocolate maggie ginger joshua daniel matthew nicole jennifer amanda biteme access mustang yankees dallas
austin cowboy matrix hello hello123 hellow welcome1 welcome123 qazwsx qazwsxedc 1qaz2wsx 1qazxsw2 qwertyuiop
asdfgh asdfghjkl zxcvbnm zxcvbn qwe123 qweasd qweasdzxc q1w2e3r4 q1w2e3r4t5 1q2w3e 1q2w3e4r5t 123qwe 123abc
abc12345 abcd1234 abcdef 123456a 123456q a123456 a1234567 aa123456 aaaaaa aaaaaaaa 11111111 22222222 00000000
12121212 11223344 987654321 87654321 7654321 0987654321 1234qwer 1234abcd 12341234 123454321 1234554321 135790
147258 147258369 159357 123789 112233 121212 131313 696969 666666 777777 888888 999999 555555 444444 333333
222222 101010 102030 1020304050 123654 654123 789456 789456123 963852741 741852963 159753 951753 357951
246810 13579 1357924680 2468013579 nacta nacta123 nacta1234 nacta@123 nacta@1234 nacta2024 nacta2025 nacta2026
admin@123 admin@1234 admin1234 admin12345 administrator pakistan pakistan123 pakistan1 islamabad lahore karachi
peshawar quetta allah allah123 muhammad muhammad123 ali123 ahmed ahmed123 hassan hussain imran khan khan123
pakistan786 786786 78692 bismillah ilovepakistan lahore123 karachi123 islamabad123 office office123 attendance
attendance1 attendance123 employee employee1 manager manager1 manager123 user user123 user1234 guest guest123
demo demo123 temp temp123 temp1234 temporary default default123 sample sample123 system system123 server
server123 database postgres postgres123 postgresql oracle mysql mysql123 sql linux ubuntu windows windows10
windows11 microsoft google google123 apple apple123 facebook facebook1 twitter instagram whatsapp youtube gmail
yahoo hotmail outlook samsung nokia iphone android monkey123 dragon123 master123 shadow123 sunshine1 princess1
letmein1 football1 baseball1 superman1 batman123 charlie1 jordan23 hunter1 harley1 ranger1 buster1 thomas1
tigger1 robert1 soccer1 killer1 hockey1 george1 andrew1 freedom1 whatever1 computer1 internet1 starwars1
cheese1 pepper1 summer1 winter1 spring1 autumn1 flower1 orange1 banana1 cookie1 chocolate1 maggie1 ginger1
joshua1 daniel1 matthew1 nicole1 jennifer1 amanda1 mustang1 yankees1 dallas1 austin1 cowboy1 matrix1 iloveyou1
iloveyou2 iloveu loveyou lovely love123 lover123 sweety sweet123 angel angel123 angels babygirl babygirl1
baby123 honey honey123 sexy123 cutie cutie123 friends friends1 family family1 mother mother1 father father1
sister brother mommy daddy secret123 secret1 secrets private private1 mypassword mypassword1 mypass mypass123
pass1234 pass12345 passwd passwd1 pa55word pa55w0rd passw0rd1 p4ssw0rd p@55w0rd p@ssw0rd1 p@ssword1 password01
password02 password11 password99 password2 password3 password4 password5 password7 password8 password9
password10 password111 password000 password2020 password2021 password2022 password2023 password2024
password2025 password2026 qwerty1 qwerty12 qwerty1234 qwerty12345 qwerty321 qwertyui qwertyu qwer1234 qwer123
qwerasdf asdf1234 asdf123 asdfasdf asdfghjk asdfgh123 asd123 asd12345 asdasd asdasd123 zxcv1234 zxcvbnm1
zxcvbnm123 zxc123 zxcasd zxcasdqwe 1qazxsw23edc qaz123 qazxsw qazwsx123 qazwsxedc123 wsxedc rfvtgb tgbyhn
yhnujm welcome12 welcome2 hello1 hello12 hello1234 helloworld helloworld1 hi123456 hithere test testing
testing123 test12 test12345 testtest test1 test2 tester tester123 testuser testuser1 qa123456 dev123 developer
developer1 programmer coder coder123 hacker hacker123 letmein123 openup open123 opensesame sesame access1
access123 enter enter123 entry login1 login123 logon logmein signin signin123 changeit change123 changeme1
changeme123 newpass newpass123 newpassword newpassword1 newuser newuser1 firstpass first123 reset reset123
resetme default1 defaultpassword initial initial1 init123 start start123 startup starter abc1234 abc123456
abc123abc abcabc abcabc123 abcd123 abcd12345 abcde12345 abcdefg abcdefg1 abcdefgh abcdefgh1 abcdefghi
abcdefghij abcdefghijkl abcdefg123 1234abc 1234abcde 123abc123 123abcd 123abcde a1b2c3 a1b2c3d4 a1b2c3d4e5
a1s2d3 a1s2d3f4 a1s2d3f4g5 1a2b3c 1a2b3c4d 1a2b3c4d5e 1a2s3d4f 1z2x3c4v 1q1q1q1q 1q1q1q 1qqqqq 1111111 11111
111111111 1111111111 11111111111 111222 111222333 112233445566 12345678910 1234567891 12345678912 123456789123
1234567890123 123456123456 123123123 123123123123 123321123 12332112 1232323q 12345a 12345q 12345qwert
12345abcde 123456789a 123456789q 123456789z 123456abc 123456aa 123456qq 123456ab 123456abcd 123456asd 123456qwe
123456qwerty 123456zz 12qwaszx 12qw34er 12qw34er56ty 1qa2ws3ed 1qa2ws3ed4rf 1qaz2wsx3edc bubbles butterfly
cameron captain carlos carter casper chelsea chester chicken chris cricket crystal dakota dennis diamond doctor
dolphin donald eagles edward elephant fishing flowers forever fuckme fuckyou gandalf gateway golfer green
guitar hammer heather helpme jackson jasmine jason jasper johnny junior justin kelly kevin knight lakers
london lucky maddog madison marine marlboro martin master1 mercedes merlin mickey midnight miller nascar
nathan newyork nirvana ninja oliver packers panther panties patrick peaches phoenix player please pookie
porsche prince purple rabbit rachel raiders rainbow richard rocket rosebud runner russia samantha sammy
samson sandra saturn scooter scorpio scott sebastian sierra silver skippy slayer smith smokey snoopy sparky
spider squirt steelers steven stupid success sunny surfer sweetie swimming taylor teacher tennis thunder tiger
tigers tomcat topgun toyota travis turtle united vampire victor victoria viking voodoo walter warrior william
willow wilson winner winston wizard wolves xavier xxxxxxxx yamaha yankee yellow zzzzzz
`;

const BASE_WORDS = RAW.split(/\s+/).filter(Boolean);

const SUFFIXES = ['1', '12', '123', '1234', '12345', '!', '@123', '#1', '2023', '2024', '2025', '2026', '786', '007'];
const TOP_BASES = [
  'password', 'welcome', 'admin', 'qwerty', 'letmein', 'login', 'nacta', 'pakistan', 'secret', 'master',
  'dragon', 'monkey', 'shadow', 'sunshine', 'football', 'iloveyou', 'changeme', 'default', 'user', 'test',
  'guest', 'office', 'attendance', 'manager', 'system', 'server', 'summer', 'winter', 'islamabad', 'lahore',
];

/** Lower-case set of every blocked password. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  ...BASE_WORDS,
  ...TOP_BASES.flatMap((b) => SUFFIXES.map((s) => b + s)),
]);

const LEET: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

/** Lower-case, strip separators and decode simple leetspeak, so "P@ssw0rd" matches "password". */
function decodeLeet(s: string): string {
  return [...s].map((c) => LEET[c] ?? c).join('');
}

/** True when the password is, or is a trivial variation of, a common password. */
export function isCommonPassword(password: string): boolean {
  const p = password.toLowerCase();
  if (COMMON_PASSWORDS.has(p)) return true;
  const stripped = p.replace(/[^a-z]+$/, ''); // "password123!" -> "password"
  if (stripped.length >= 4 && COMMON_PASSWORDS.has(stripped)) return true;
  const leet = decodeLeet(p);
  if (COMMON_PASSWORDS.has(leet)) return true;
  const leetStripped = leet.replace(/[^a-z]+$/, '');
  if (leetStripped.length >= 4 && (COMMON_PASSWORDS.has(leetStripped) || COMMON_PASSWORDS.has(decodeLeet(leetStripped)))) {
    return true;
  }
  // The same character repeated ("aaaaaaaaaaaa") or a short block repeated ("abcabcabcabc").
  if (/^(.{1,4})\1+$/.test(p)) return true;
  return false;
}
