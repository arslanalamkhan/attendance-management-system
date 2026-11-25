// Port of the former parse.selftest.js: every case kept, no database needed.
import { describe, expect, it } from 'vitest';
import * as c from './commands';
import * as p from './parse';
import type { BioRecord, TemplateRecord } from './parse';

describe('ATTLOG parsing', () => {
  it('ATTLOG LF, tabs, trailing blanks', () => {
    const body = '1\t2024-05-01 08:01:02\t0\t1\t0\t0\t0\n12\t2024-05-01 17:30:00\t1\t15\t\t\n';
    const { records, skipped } = p.parseAttlog(body);
    expect(skipped.length).toBe(0);
    expect(records.length).toBe(2);
    expect({ ...records[0], raw: undefined }).toEqual({
      pin: '1',
      punchTime: '2024-05-01 08:01:02',
      status: 0,
      verifyType: 1,
      workCode: '0',
      raw: undefined,
    });
    expect(records[1]?.pin).toBe('12');
    expect(records[1]?.verifyType).toBe(15);
    expect(records[1]?.workCode).toBeNull();
  });

  it('ATTLOG CRLF, blank lines, junk lines skipped', () => {
    const body =
      '5\t2024-05-02 09:00:00\t0\t1\r\n\r\ngarbage\r\n6\t2024-13-40 09:00:00\t0\t1\r\n7\t2024-05-02T10:00:00\t4\t1\r\n  \r\n';
    const { records, skipped } = p.parseAttlog(body);
    expect(records.map((r) => [r.pin, r.punchTime])).toEqual([
      ['5', '2024-05-02 09:00:00'],
      ['7', '2024-05-02 10:00:00'],
    ]);
    expect(skipped.length).toBe(2);
  });

  it('ATTLOG space-separated fallback', () => {
    const { records } = p.parseAttlog('3 2024-05-03 08:00:00 0 1\n');
    expect(records.length).toBe(1);
    expect(records[0]?.pin).toBe('3');
    expect(records[0]?.status).toBe(0);
  });

  it('ATTLOG empty / null / Buffer bodies', () => {
    expect(p.parseAttlog('').records.length).toBe(0);
    expect(p.parseAttlog(undefined).records.length).toBe(0);
    expect(p.parseAttlog(null).records.length).toBe(0);
    expect(p.parseAttlog(Buffer.from('9\t2024-01-01 00:00:00\t0\t1\n')).records.length).toBe(1);
  });

  it('strips a UTF-8 BOM and NUL bytes', () => {
    const { records } = p.parseAttlog('﻿4\t2024-01-01 00:00:00\t0\t1\0\n');
    expect(records.length).toBe(1);
    expect(records[0]?.pin).toBe('4');
  });
});

describe('INFO, params, devicecmd, options', () => {
  it('INFO query', () => {
    const i = p.parseInfo('Ver 8.0.4.4-20211008,12,3,456,192.168.1.201,10,7,5,0');
    expect(i).toEqual({ fwVersion: 'Ver 8.0.4.4-20211008', userCount: 12, fpCount: 3, attCount: 456, ip: '192.168.1.201', faceCount: 5 });
    const short = p.parseInfo('V1,2,3');
    expect(short?.attCount).toBeNull();
    expect(short?.faceCount).toBeNull();
    expect(p.parseInfo('')).toBeNull();
    expect(p.parseInfo(undefined)).toBeNull();
  });

  it('getParam is case-insensitive', () => {
    expect(p.getParam({ sn: 'ABC', Table: 'ATTLOG' }, 'SN')).toBe('ABC');
    expect(p.getParam({ SN: ['X', 'Y'] }, 'sn')).toBe('X');
    expect(p.getParam({}, 'SN')).toBeUndefined();
    expect(p.getParam(undefined, 'SN')).toBeUndefined();
  });

  it('devicecmd single line', () => {
    const r = p.parseDeviceCmd('ID=12&Return=0&CMD=REBOOT');
    expect(r.results).toEqual([{ id: 12, returnCode: 0, cmd: 'REBOOT', data: {} }]);
  });

  it('devicecmd multiple lines, CRLF, negative return', () => {
    const r = p.parseDeviceCmd('ID=1&Return=0&CMD=INFO\r\nID=2&Return=-1002&CMD=DATA\r\n');
    expect(r.results.length).toBe(2);
    expect(r.results[1]?.id).toBe(2);
    expect(r.results[1]?.returnCode).toBe(-1002);
  });

  it('devicecmd INFO with k=v data lines', () => {
    const r = p.parseDeviceCmd('ID=3&Return=0&CMD=INFO\nFWVersion=Ver 1.2\nUserCount=7\n~DeviceName=SenseFace 7A');
    expect(r.results.length).toBe(1);
    expect(r.results[0]?.data.FWVersion).toBe('Ver 1.2');
    expect(r.data.UserCount).toBe('7');
    expect(r.data.DeviceName).toBe('SenseFace 7A'); // leading '~' is stripped from keys
  });

  it('devicecmd empty / garbage', () => {
    expect(p.parseDeviceCmd('').results).toEqual([]);
    expect(p.parseDeviceCmd(undefined).results).toEqual([]);
    expect(p.parseDeviceCmd('hello world').results).toEqual([]);
  });

  it('options k=v (comma and newline separated)', () => {
    const kv = p.parseKeyValues('~DeviceName=SenseFace 7A,MAC=00:17:61:aa:bb:cc\r\nFWVersion=Ver 3.0.5\nTransTimes=00:00;14:05');
    expect(kv.DeviceName).toBe('SenseFace 7A');
    expect(kv.MAC).toBe('00:17:61:aa:bb:cc');
    expect(kv.FWVersion).toBe('Ver 3.0.5');
    expect(kv.TransTimes).toBe('00:00;14:05');
    expect(p.parseKeyValues('')).toEqual({});
  });

  it('OPERLOG lines', () => {
    const e = p.parseOperlog('USER PIN=1\tName=Ali\tPri=0\r\nFP PIN=1\tFID=0\r\nOPLOG 4\t0\t2024-05-01 08:00:00\r\n');
    expect(e.length).toBe(3);
    expect(e[0]?.type).toBe('USER');
    expect(e[0]?.fields.Name).toBe('Ali');
    expect(e[1]?.type).toBe('FP');
    expect(e[2]?.type).toBe('OPLOG');
  });
});

describe('command builders', () => {
  it('commands', () => {
    expect(c.info()).toBe('INFO');
    expect(c.check()).toBe('CHECK');
    expect(c.reboot()).toBe('REBOOT');
    // 2024-05-01 08:00:00 local
    const expected = (24 * 12 * 31 + 4 * 31 + 0) * 86400 + 8 * 3600;
    expect(c.encodeZkTime(new Date(2024, 4, 1, 8, 0, 0))).toBe(expected);
    expect(c.syncTime(new Date(2024, 4, 1, 8, 0, 0))).toBe(`SET OPTION DateTime=${expected}`);
  });
});

// ---- Phase 2: user / template lines ------------------------------------------
// Real OPERLOG body from VDE2244500040 (two USER lines; note trailing space in Name, Verify=-1).
const REAL_USERS =
  'USER PIN=9776\tName=Test Person \tPri=14\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1\tViceCard=\tStartDatetime=0\tEndDatetime=0\n' +
  'USER PIN=9777\tName=Sample Employee\tPri=14\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1\tViceCard=\tStartDatetime=0\tEndDatetime=0\n';
// Real OPLOG lines from the same device.
const REAL_OPLOG = 'OPLOG 0\t0\t2026-11-22 19:51:52\t0\t0\t0\t0\nOPLOG 3\t0\t2026-11-22 19:52:02\t54\t0\t0\t0\n';
// Template lines are synthetic (no real FP/BIODATA seen yet); TMP trimmed.
const FP_LINE = 'FP PIN=12\tFID=6\tSize=1340\tValid=1\tTMP=SUZTUzIxAAADyMkECAUHCc7QAAAbyWkBAAAAg+0AzcjLAJ4PZQBHyIYAiAA==';
const BIO_LINE = 'BIODATA Pin=12\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=58\tMinorVer=0\tFormat=0\tTmp=AAAAbWFnaWM+/abc123=';

describe('user and template lines', () => {
  it('real USER lines (OPERLOG)', () => {
    const { records, other, skipped } = p.parseUserData(REAL_USERS + REAL_OPLOG);
    expect(records.length).toBe(2);
    expect(other).toBe(2);
    expect(skipped).toBe(0);
    expect({ ...records[0], raw: undefined }).toEqual({
      kind: 'user',
      pin: '9776',
      name: 'Test Person',
      privilege: 14,
      card: null,
      password: null,
      grp: '1',
      raw: undefined,
    });
    expect(records[1]).toMatchObject({ name: 'Sample Employee' });
  });

  it('USER line with card/password, mixed key case, no leading token (table=USERINFO)', () => {
    const { records } = p.parseUserData('Pin=5\tNAME=Sara\tpri=0\tPASSWD=1234\tCard=[1234567890]\tGrp=1\r\n', 'USERINFO');
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({ kind: 'user', password: '1234', card: '[1234567890]', privilege: 0 });
  });

  it('tokenless lines without a hint are not user data', () => {
    expect(p.parseUserData('PIN=5\tName=Sara').records.length).toBe(0);
    expect(p.parseUserLine('OPLOG 4\t0\t2024-05-01 08:00:00')).toBeNull();
  });

  it('USER name containing a comma and ampersand survives', () => {
    const { records } = p.parseUserData('USER PIN=8\tName=Khan, A & Sons\tPri=0\n');
    expect(records[0]).toMatchObject({ name: 'Khan, A & Sons' });
  });

  it('FP line (FID / Size / Valid / TMP, with base64 padding)', () => {
    const { records } = p.parseUserData(FP_LINE);
    expect(records.length).toBe(1);
    const r = records[0] as TemplateRecord;
    expect([r.kind, r.pin, r.idx, r.size, r.valid]).toEqual(['fp', '12', 6, 1340, 1]);
    expect(r.data.endsWith('==')).toBe(true);
    expect(r.raw).toBe(FP_LINE);
  });

  it('FP line via table=FINGERTMP, upper-case keys, no token', () => {
    const { records } = p.parseUserData('PIN=3\tFID=1\tSIZE=10\tVALID=1\tTMP=QUJD\n', 'FINGERTMP');
    const r = records[0] as TemplateRecord;
    expect([r.kind, r.pin, r.idx, r.data]).toEqual(['fp', '3', 1, 'QUJD']);
  });

  it('FACE line and its No= variant', () => {
    const a = p.parseUserData('FACE PIN=4\tFID=0\tSIZE=2000\tVALID=1\tTMP=ZmFjZQ==').records[0] as TemplateRecord;
    expect([a.kind, a.pin, a.idx, a.size]).toEqual(['face', '4', 0, 2000]);
    const b = p.parseUserData('FACE Pin=4\tNo=2\tValid=1\tTmp=ZmFjZQ==').records[0] as TemplateRecord;
    expect(b.idx).toBe(2);
  });

  it('BIODATA line', () => {
    const r = p.parseUserData(BIO_LINE).records[0] as BioRecord;
    expect([r.kind, r.pin, r.bioType, r.idx, r.valid]).toEqual(['bio', '12', 9, 0, 1]);
    expect(r.data).toBe('AAAAbWFnaWM+/abc123=');
  });

  it('USERPIC / BIOPHOTO lines', () => {
    const a = p.parseUserData('USERPIC PIN=7\tFileName=7.jpg\tSize=12\tContent=/9j/4AAQSkZJRg==').records[0];
    expect(a).toMatchObject({ kind: 'pic', pin: '7', fileName: '7.jpg', content: '/9j/4AAQSkZJRg==' });
    const b = p.parseUserData('BIOPHOTO PIN=7\tFileName=7.jpg\tType=9\tSize=12\tContent=/9j/4AAQ=').records[0];
    expect(b?.kind).toBe('biophoto');
  });

  it('mixed body: USER + FP + BIODATA + OPLOG, CRLF, junk and incomplete lines', () => {
    const body = [REAL_USERS.trim(), FP_LINE, BIO_LINE, 'OPLOG 4\t0\t2024-05-01 08:00:00', 'FP PIN=9\tFID=1', 'garbage', ''].join('\r\n');
    const { records, other, skipped } = p.parseUserData(body);
    expect(records.map((r) => r.kind)).toEqual(['user', 'user', 'fp', 'bio']);
    expect(skipped).toBe(1); // FP without TMP
    expect(other).toBe(2); // OPLOG + garbage
  });

  it('devicecmd body: result line followed by user lines', () => {
    const body = 'ID=21&Return=0&CMD=DATA QUERY\n' + REAL_USERS;
    expect(p.parseDeviceCmd(body).results[0]?.id).toBe(21);
    expect(p.parseUserData(body).records.length).toBe(2);
  });

  it('user data: empty / null / Buffer', () => {
    expect(p.parseUserData('').records.length).toBe(0);
    expect(p.parseUserData(null).records.length).toBe(0);
    expect(p.parseUserData(Buffer.from(REAL_USERS)).records.length).toBe(2);
  });
});

describe('user and template commands', () => {
  it('user commands', () => {
    expect(c.updateUserInfo({ pin: '12', name: 'Ali\tKhan\r\n', privilege: 0, password: '', card: '' })).toBe(
      'DATA UPDATE USERINFO PIN=12\tName=Ali Khan\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard=',
    );
    expect(c.updateUserInfo({ pin: '1', name: 'x'.repeat(40) })).toContain(`\tName=${'x'.repeat(24)}\t`);
    expect(c.cleanName('A'.repeat(30)).length).toBe(24);
    expect(c.deleteUserInfo('12')).toBe('DATA DELETE USERINFO PIN=12');
    expect(c.queryUserInfo()).toBe('DATA QUERY USERINFO');
    expect(c.queryFingerTmp()).toBe('DATA QUERY FINGERTMP');
    expect(c.queryFaceBiodata()).toBe('DATA QUERY BIODATA Type=9');
    expect(c.updateFingerTmp({ pin: '12', fid: 6, size: 1340, valid: 1, tmp: 'QUJD' })).toBe(
      'DATA UPDATE FINGERTMP PIN=12\tFID=6\tSize=1340\tValid=1\tTMP=QUJD',
    );
  });

  it('BIODATA update rebuilt from stored raw fields round-trips', () => {
    const rec = p.parseUserData(BIO_LINE).records[0] as BioRecord;
    const cmd = c.updateTemplate({ ...rec, bioType: rec.bioType });
    expect(cmd).toBe('DATA UPDATE ' + BIO_LINE);
    // Duress / versions come from raw even when columns are all that is passed in.
    const row = { pin: '12', idx: 0, valid: 1, bioType: 9, data: 'XYZ', raw: BIO_LINE.replace('Duress=0', 'Duress=1').replace('MajorVer=58', 'MajorVer=59') };
    expect(c.updateBiodata(row)).toContain('\tDuress=1\t');
    expect(c.updateBiodata(row)).toContain('\tMajorVer=59\t');
    expect(c.updateBiodata(row).endsWith('\tTmp=XYZ')).toBe(true);
  });

  it('command echo parses back as a user record', () => {
    const cmd = c.updateUserInfo({ pin: '12', name: 'Ali', privilege: 14 });
    const parsed = p.parseUserLine(cmd.replace(/^DATA UPDATE /, ''));
    const rec = parsed && p.normalizeUserRecord(parsed);
    expect(rec).toMatchObject({ pin: '12', name: 'Ali', privilege: 14 });
  });
});
