import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Switch, StyleSheet, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as XLSX from 'xlsx';

const ROW_H = 64;
let db;

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
    );`);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('import');
  const [students, setStudents] = useState([]);
  const [absent, setAbsent] = useState({});
  const [done, setDone] = useState({});
  const [cur, setCur] = useState(0);
  const [report, setReport] = useState({ date: null, rows: [] });
  const listRef = useRef(null);

  useEffect(() => {
    (async () => { await initDb(); await loadStudents(); setReady(true); })();
  }, []);

  async function loadStudents() {
    setStudents(await db.getAllAsync('SELECT * FROM Students ORDER BY id'));
    setAbsent({}); setDone({}); setCur(0);
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

  function mark(isAbsent) {
    if (!students.length || finished) return;
    const s = students[cur];
    setAbsent(a => {
      const n = { ...a };
      if (isAbsent) n[s.id] = true; else delete n[s.id];
      return n;
    });
    const nd = { ...done, [s.id]: true };
    setDone(nd);
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

  async function saveAttendance() {
    try {
      const now = new Date().toISOString();
      const day = now.slice(0, 10);
      await db.runAsync('DELETE FROM Absence WHERE substr(date_time,1,10) = ?', [day]);
      for (const id of Object.keys(absent)) {
        await db.runAsync('INSERT INTO Absence (date_time, student_id) VALUES (?,?)', [now, Number(id)]);
      }
      await loadReport();
      setTab('report');
      Alert.alert('Saved', absentCount + ' absentee(s) saved');
    } catch (e) {
      Alert.alert('Save failed', String(e.message || e));
    }
  }

  // ---------- Report ----------
  async function loadReport() {
    const rows = await db.getAllAsync(
      `SELECT s.id, s.student_name, s.roll_number, s.course_name, a.date_time
       FROM Absence a JOIN Students s ON s.id = a.student_id
       WHERE substr(a.date_time,1,10) = (SELECT MAX(substr(date_time,1,10)) FROM Absence)
       ORDER BY s.id`);
    setReport({ date: rows.length ? rows[0].date_time.slice(0, 10) : null, rows });
  }

  useEffect(() => {
    if (ready && tab === 'report') loadReport();
  }, [tab, ready]);

  async function printReport() {
    const body = report.rows.map((r, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + r.student_name + '</td><td>' + r.roll_number + '</td><td>' + (r.course_name || '') + '</td></tr>'
    ).join('');
    const html = '<html><body style="font-family:sans-serif"><h2>Absentees - ' + (report.date || '') + '</h2>' +
      '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">' +
      '<tr><th>#</th><th>Name</th><th>Roll No.</th><th>Course</th></tr>' + body + '</table>' +
      '<p>Total absent: ' + report.rows.length + '</p></body></html>';
    try { await Print.printAsync({ html }); } catch (e) { Alert.alert('Print failed', String(e.message || e)); }
  }

  if (!ready) {
    return (
      <SafeAreaView style={st.c}>
        <Text style={st.pad}>Loading...</Text>
      </SafeAreaView>
    );
  }

  const tabs = [['import', 'Import'], ['attend', 'Attendance'], ['report', 'Absentees']];

  return (
    <SafeAreaView style={st.c}>
      <StatusBar style="dark" />
      <Text style={st.title}>Student Attendance</Text>

      <View style={st.tabs}>
        {tabs.map(([k, l]) => (
          <TouchableOpacity key={k} style={[st.tab, tab === k && st.tabOn]} onPress={() => setTab(k)}>
            <Text style={[st.tabT, tab === k && { color: '#fff' }]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'import' && (
        <ScrollView contentContainerStyle={st.pad}>
          <Text style={st.h}>Import students from Excel</Text>
          <Text style={st.mu}>Columns: Student Name, Roll Number, Course Name. Importing replaces existing students.</Text>
          <TouchableOpacity style={st.btn} onPress={importExcel}>
            <Text style={st.btnT}>Choose Excel file</Text>
          </TouchableOpacity>
          <Text style={[st.h, { marginTop: 20 }]}>Students ({students.length})</Text>
          {students.map(s => (
            <Text key={s.id} style={st.line}>{s.id}. {s.student_name} - {s.roll_number} - {s.course_name}</Text>
          ))}
        </ScrollView>
      )}

      {tab === 'attend' && (
        <View style={{ flex: 1 }}>
          <View style={st.prog}>
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
                <TouchableOpacity style={[st.btn, { marginTop: 0 }]} onPress={saveAttendance}>
                  <Text style={st.btnT}>Save attendance</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {tab === 'report' && (
        <ScrollView contentContainerStyle={st.pad}>
          <Text style={st.h}>Absentees {report.date ? '- ' + report.date : ''} ({report.rows.length})</Text>
          {report.rows.length === 0 && <Text style={st.mu}>No absentees saved yet.</Text>}
          {report.rows.map((r, i) => (
            <Text key={r.id} style={st.line}>{i + 1}. {r.student_name} - {r.roll_number} - {r.course_name}</Text>
          ))}
          <TouchableOpacity style={st.btn} onPress={printReport}>
            <Text style={st.btnT}>Print list</Text>
          </TouchableOpacity>
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
  line: { paddingVertical: 4, fontSize: 14 },
  tabs: { flexDirection: 'row', gap: 6, padding: 12 },
  tab: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e5ea', alignItems: 'center' },
  tabOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  tabT: { fontWeight: '600' },
  btn: { backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  btnT: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
