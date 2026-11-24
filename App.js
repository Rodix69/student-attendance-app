import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Switch, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as XLSX from 'xlsx';

const ROW_H = 64;
let db;

// ---------- date helpers (local dates, format YYYY-MM-DD) ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayStr = () => fmt(new Date());
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(new Date(s + 'T12:00:00')) === s;
const shiftDate = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return fmt(d); };
const monthStart = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01'; };
const nowTime = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };

async function initDb() {
  db = await SQLite.openDatabaseAsync('attendance.db');
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS Students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      course_name TEXT
    );
    CREATE TABLE IF NOT EXISTS Absence (
      date_time TEXT NOT NULL,
      student_id INTEGER NOT NULL,
      FOREIGN KEY (student_id) REFERENCES Students(id)
    );
    CREATE TABLE IF NOT EXISTS AttendanceDays (
      att_date TEXT PRIMARY KEY
    );
    INSERT OR IGNORE INTO AttendanceDays (att_date)
      SELECT DISTINCT substr(date_time,1,10) FROM Absence;`);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('import');
  const [students, setStudents] = useState([]);
  const [absent, setAbsent] = useState({});
  const [done, setDone] = useState({});
  const [cur, setCur] = useState(0);
  const [attDate, setAttDate] = useState(todayStr());
  const [attStarted, setAttStarted] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [repType, setRepType] = useState(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayStr());
  const [result, setResult] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    (async () => { await initDb(); await loadStudents(); setReady(true); })();
  }, []);

  async function loadStudents() {
    setStudents(await db.getAllAsync('SELECT * FROM Students ORDER BY id'));
    setAbsent({}); setDone({}); setCur(0); setAttStarted(false);
  }

  function goTab(k) {
    setTab(k);
    if (k === 'attend') { setAttStarted(false); setAttDate(todayStr()); }
    if (k === 'report') { setResult(null); setRepType(null); }
  }

  // ---------- Import ----------
  async function importExcel() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled) return;
      const resp = await fetch(res.assets[0].uri);
      const buf = await resp.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const rows = json.map(o => {
        const r = {};
        Object.keys(o).forEach(k => { r[k.toLowerCase().replace(/[^a-z]/g, '')] = String(o[k]).trim(); });
        return { name: r.studentname || r.name, roll: r.rollnumber || r.rollno || r.roll, course: r.coursename || r.course };
      }).filter(r => r.name && r.roll);
      if (!rows.length) {
        Alert.alert('No data', 'Columns needed: Student Name, Roll Number, Course Name');
        return;
      }
      await db.runAsync('DELETE FROM Absence');
      await db.runAsync('DELETE FROM AttendanceDays');
      await db.runAsync('DELETE FROM Students');
      for (const r of rows) {
        await db.runAsync('INSERT INTO Students (student_name, roll_number, course_name) VALUES (?,?,?)', [r.name, r.roll, r.course]);
      }
      await loadStudents();
      Alert.alert('Imported', rows.length + ' students');
    } catch (e) {
      Alert.alert('Import failed', String(e.message || e));
    }
  }

  // ---------- Attendance ----------
  const markedCount = Object.keys(done).length;
  const absentCount = Object.keys(absent).length;
  const finished = students.length > 0 && markedCount >= students.length;

  async function startAttendance() {
    if (!validDate(attDate)) { Alert.alert('Invalid date', 'Use the format YYYY-MM-DD, e.g. 2026-11-25'); return; }
    try {
      const rows = await db.getAllAsync('SELECT student_id FROM Absence WHERE substr(date_time,1,10) = ?', [attDate]);
      const map = {};
      rows.forEach(r => { map[r.student_id] = true; });
      const day = await db.getAllAsync('SELECT att_date FROM AttendanceDays WHERE att_date = ?', [attDate]);
      setAlreadySaved(day.length > 0);
      setAbsent(map); setDone({}); setCur(0); setAttStarted(true);
    } catch (e) { Alert.alert('Error', String(e.message || e)); }
  }

  async function saveDay(absMap) {
    try {
      await db.runAsync('DELETE FROM Absence WHERE substr(date_time,1,10) = ?', [attDate]);
      const stamp = attDate + ' ' + nowTime();
      for (const id of Object.keys(absMap)) {
        await db.runAsync('INSERT INTO Absence (date_time, student_id) VALUES (?,?)', [stamp, Number(id)]);
      }
      await db.runAsync('INSERT OR REPLACE INTO AttendanceDays (att_date) VALUES (?)', [attDate]);
      setAlreadySaved(true);
      Alert.alert('Saved', 'Attendance for ' + attDate + ' saved. Absent: ' + Object.keys(absMap).length);
    } catch (e) {
      Alert.alert('Save failed', String(e.message || e));
    }
  }

  function mark(isAbsent) {
    if (!students.length || finished) return;
    const s = students[cur];
    const na = { ...absent };
    if (isAbsent) na[s.id] = true; else delete na[s.id];
    const nd = { ...done, [s.id]: true };
    setAbsent(na);
    setDone(nd);
    if (Object.keys(nd).length >= students.length) {
      saveDay(na); // day complete: save automatically
      return;
    }
    let nx = cur + 1;
    while (nx < students.length && nd[students[nx].id]) nx++;
    if (nx < students.length) {
      setCur(nx);
      try { listRef.current?.scrollToIndex({ index: nx, viewPosition: 0.4 }); } catch (e) {}
    }
  }

  function toggle(id, v) {
    setAbsent(a => {
      const n = { ...a };
      if (v) n[id] = true; else delete n[id];
      return n;
    });
  }

  // ---------- Reports ----------
  async function runReport() {
    if (!validDate(from) || !validDate(to)) { Alert.alert('Invalid date', 'Use the format YYYY-MM-DD'); return; }
    if (from > to) { Alert.alert('Invalid range', 'The start date is after the end date.'); return; }
    try {
      const days = await db.getAllAsync('SELECT att_date FROM AttendanceDays WHERE att_date BETWEEN ? AND ? ORDER BY att_date', [from, to]);
      const abs = await db.getAllAsync(
        `SELECT s.id, s.student_name, s.roll_number, substr(a.date_time,1,10) AS d
         FROM Absence a JOIN Students s ON s.id = a.student_id
         WHERE substr(a.date_time,1,10) BETWEEN ? AND ?
         ORDER BY d, s.id`, [from, to]);
      const period = from + ' to ' + to;
      const note = days.length + ' attendance day(s) recorded in this period.';
      let title, lines;
      if (repType === 1) {
        title = 'Absence during ' + period;
        lines = abs.map(r => r.student_name + '   ' + r.d);
      } else {
        const counts = {};
        abs.forEach(r => { counts[r.id] = (counts[r.id] || 0) + 1; });
        const all = students;
        if (repType === 2) {
          title = 'Absent every day: ' + period;
          lines = days.length ? all.filter(s => counts[s.id] === days.length).map(s => s.student_name) : [];
        } else {
          title = 'Present every day: ' + period;
          lines = days.length ? all.filter(s => !counts[s.id]).map(s => s.student_name) : [];
        }
      }
      setResult({ title, lines, note, noDays: days.length === 0 });
    } catch (e) { Alert.alert('Report failed', String(e.message || e)); }
  }

  async function printReport() {
    if (!result) return;
    const body = result.lines.map(l => '<p style="margin:4px 0">' + l.replace(/ {3}/g, ' &nbsp;&nbsp; ') + '</p>').join('');
    const html = '<html><body style="font-family:sans-serif"><h2>' + result.title + '</h2>' + body +
      '<p><i>' + result.note + ' Total rows: ' + result.lines.length + '</i></p></body></html>';
    try { await Print.printAsync({ html }); } catch (e) { Alert.alert('Print failed', String(e.message || e)); }
  }

  if (!ready) {
    return (
      <SafeAreaView style={st.c}>
        <Text style={st.pad}>Loading...</Text>
      </SafeAreaView>
    );
  }

  const tabs = [['import', 'Import'], ['attend', 'Attendance'], ['report', 'Reports']];
  const repOptions = [
    [1, 'Absence during a period', 'Every absence with name and date'],
    [2, 'Absent every day', 'Students absent on all days in the period'],
    [3, 'Present every day', 'Students present on all days in the period'],
  ];

  return (
    <SafeAreaView style={st.c}>
      <StatusBar style="dark" />
      <Text style={st.title}>Student Attendance</Text>

      <View style={st.tabs}>
        {tabs.map(([k, l]) => (
          <TouchableOpacity key={k} style={[st.tab, tab === k && st.tabOn]} onPress={() => goTab(k)}>
            <Text style={[st.tabT, tab === k && { color: '#fff' }]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'import' && (
        <ScrollView contentContainerStyle={st.pad}>
          <Text style={st.h}>Import students from Excel</Text>
          <Text style={st.mu}>Columns: Student Name, Roll Number, Course Name. Importing replaces existing students and clears saved attendance.</Text>
          <TouchableOpacity style={st.btn} onPress={importExcel}>
            <Text style={st.btnT}>Choose Excel file</Text>
          </TouchableOpacity>
          <Text style={[st.h, { marginTop: 20 }]}>Students ({students.length})</Text>
          {students.map(s => (
            <Text key={s.id} style={st.line}>{s.id}. {s.student_name} - {s.roll_number} - {s.course_name}</Text>
          ))}
        </ScrollView>
      )}

      {tab === 'attend' && !attStarted && (
        <View style={st.pad}>
          <Text style={st.h}>Date of attendance</Text>
          <Text style={st.mu}>Defaults to today. Edit it to take attendance for any date (YYYY-MM-DD).</Text>
          <View style={st.dateRow}>
            <TouchableOpacity style={st.small} onPress={() => validDate(attDate) && setAttDate(shiftDate(attDate, -1))}><Text style={st.smallT}>-</Text></TouchableOpacity>
            <TextInput style={st.input} value={attDate} onChangeText={setAttDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
            <TouchableOpacity style={st.small} onPress={() => validDate(attDate) && setAttDate(shiftDate(attDate, 1))}><Text style={st.smallT}>+</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={st.btn} onPress={startAttendance}>
            <Text style={st.btnT}>Start attendance</Text>
          </TouchableOpacity>
          {students.length === 0 && <Text style={[st.mu, { marginTop: 12 }]}>No students yet. Import an Excel file first.</Text>}
        </View>
      )}

      {tab === 'attend' && attStarted && (
        <View style={{ flex: 1 }}>
          <View style={st.prog}>
            <View style={st.dateHead}>
              <Text style={st.h}>Date: {attDate}</Text>
              <TouchableOpacity onPress={() => setAttStarted(false)}><Text style={st.link}>Change date</Text></TouchableOpacity>
            </View>
            {alreadySaved && <Text style={st.warn}>Already saved for this date. Saving again will overwrite it.</Text>}
            <Text style={st.h}>Marked {markedCount} of {students.length} - Absent {absentCount}</Text>
            <View style={st.bar}>
              <View style={[st.fill, { width: students.length ? (markedCount / students.length * 100) + '%' : '0%' }]} />
            </View>
          </View>

          <FlatList
            ref={listRef}
            data={students}
            extraData={[absent, cur, done]}
            keyExtractor={s => String(s.id)}
            getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
            ListEmptyComponent={<Text style={st.pad}>No students. Import an Excel file first.</Text>}
            renderItem={({ item, index }) => {
              const isAbs = !!absent[item.id];
              return (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setCur(index)}
                  style={[st.row, isAbs && st.rowAbs, index === cur && !finished && st.rowCur]}
                >
                  <Text style={st.sl}>{index + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name}>{item.student_name}</Text>
                    <Text style={st.mu}>{item.roll_number} - {item.course_name}</Text>
                  </View>
                  <Text style={st.mu}>Absent</Text>
                  <Switch value={isAbs} onValueChange={v => toggle(item.id, v)} trackColor={{ true: '#dc2626' }} />
                </TouchableOpacity>
              );
            }}
          />

          {students.length > 0 && (
            <View>
              {!finished && (
                <View style={st.foot}>
                  <TouchableOpacity style={[st.btn, { flex: 1, backgroundColor: '#16a34a' }]} onPress={() => mark(false)}>
                    <Text style={st.btnT}>Present</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.btn, { flex: 1, backgroundColor: '#dc2626' }]} onPress={() => mark(true)}>
                    <Text style={st.btnT}>Absent</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                <TouchableOpacity style={[st.btn, { marginTop: 0 }]} onPress={() => saveDay(absent)}>
                  <Text style={st.btnT}>Save attendance</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {tab === 'report' && (
        <ScrollView contentContainerStyle={st.pad}>
          <Text style={st.h}>Choose a report</Text>
          {repOptions.map(([k, t, sub]) => (
            <TouchableOpacity key={k} style={[st.opt, repType === k && st.optOn]} onPress={() => { setRepType(k); setResult(null); }}>
              <Text style={st.name}>{t}</Text>
              <Text style={st.mu}>{sub}</Text>
            </TouchableOpacity>
          ))}

          {repType !== null && (
            <View style={{ marginTop: 14 }}>
              <Text style={st.h}>Select the period</Text>
              <Text style={st.mu}>From date</Text>
              <TextInput style={st.input} value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
              <Text style={[st.mu, { marginTop: 8 }]}>To date</Text>
              <TextInput style={st.input} value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
              <TouchableOpacity style={st.btn} onPress={runReport}>
                <Text style={st.btnT}>Show report</Text>
              </TouchableOpacity>
            </View>
          )}

          {result && (
            <View style={st.resBox}>
              <Text style={st.h}>{result.title}</Text>
              <Text style={st.mu}>{result.note}</Text>
              {result.noDays && <Text style={st.warn}>No attendance has been saved in this period.</Text>}
              {!result.noDays && result.lines.length === 0 && <Text style={[st.line, { marginTop: 6 }]}>No students found.</Text>}
              {result.lines.map((l, i) => (
                <Text key={i} style={st.line}>{l}</Text>
              ))}
              {result.lines.length > 0 && (
                <TouchableOpacity style={st.btn} onPress={printReport}>
                  <Text style={st.btnT}>Print list</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#f5f6f8' },
  title: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 8 },
  pad: { padding: 16 },
  h: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  mu: { color: '#6b7280', fontSize: 13 },
  line: { paddingVertical: 4, fontSize: 15 },
  warn: { color: '#b45309', fontSize: 13, marginBottom: 6 },
  link: { color: '#2563eb', fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 6, padding: 12 },
  tab: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea', alignItems: 'center' },
  tabOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  tabT: { fontWeight: '600' },
  btn: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  btnT: { color: '#fff', fontWeight: '700', fontSize: 16 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 10, padding: 12, fontSize: 16, flex: 1, marginTop: 4 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  dateHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  small: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  smallT: { fontSize: 22, fontWeight: '700' },
  opt: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea', borderRadius: 10, padding: 12, marginTop: 8 },
  optOn: { borderColor: '#2563eb', backgroundColor: '#dbeafe' },
  resBox: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e5ea', padding: 12, marginTop: 16 },
  prog: { paddingHorizontal: 16 },
  bar: { height: 8, backgroundColor: '#e2e5ea', borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#2563eb' },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e2e5ea', borderLeftWidth: 5, borderLeftColor: 'transparent' },
  rowCur: { backgroundColor: '#dbeafe', borderLeftColor: '#2563eb' },
  rowAbs: { backgroundColor: '#fee2e2', borderLeftColor: '#dc2626' },
  sl: { width: 28, color: '#6b7280' },
  name: { fontWeight: '600', fontSize: 15 },
  foot: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#f5f6f8' },
});
