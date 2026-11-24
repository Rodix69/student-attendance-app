# Student Attendance App

A simple mobile attendance app built with React Native (Expo) and SQLite.
Import students from Excel, mark attendance one student at a time, and print the absentees list.

## Features

- **Import from Excel** - reads `.xlsx` files with the columns `Student Name`, `Roll Number`, `Course Name`.
- **Attendance by date** - choosing Attendance first asks for the date (default today, editable to any date).
  - List with Sl. No., Name, Roll Number and an Absent toggle.
  - **Present** / **Absent** buttons mark the highlighted student and move to the next. Present is the default.
  - Row colours: blue = current student, red = absent. Progress bar shows how many are marked.
  - The day is saved automatically when every student is marked (or press **Save attendance**). Re-opening a date lets you edit it.
- **Three reports for a date range (From / To):**
  1. **Absence during a period** - one row per absence, with name and date.
  2. **Absent every day** - names of students absent on all recorded days in the period.
  3. **Present every day** - names of students present on all recorded days in the period.
  All reports can be printed.

Only days on which attendance was saved count as attendance days in the reports.

## Database (SQLite, on the device)

**Students**

| Column | Type |
|---|---|
| id | INTEGER, primary key |
| student_name | TEXT |
| roll_number | TEXT |
| course_name | TEXT |

**Absence**

| Column | Type |
|---|---|
| date_time | TEXT (ISO timestamp) |
| student_id | INTEGER, foreign key to Students(id) |

**AttendanceDays** (helper table) - one row per date on which attendance was taken (`att_date`, primary key). It lets the reports know which days count, so "present every day" can be worked out.

## Getting started

Requirements: [Node.js](https://nodejs.org) and the **Expo Go** app on your phone (same Wi-Fi as your computer).

```bash
git clone <your-repo-url>
cd <repo-folder>
npm install
npx expo install --fix
npx expo start -c
```

Scan the QR code with Expo Go (Android) or the Camera app (iPhone).

## Excel format

| Student Name | Roll Number | Course Name |
|---|---|---|
| Aarav Sharma | R101 | BSc Maths |
| Diya Patel | R102 | BSc Physics |

The first row must be the headers. Importing replaces the existing students and clears saved absences.

## Project structure

```
App.js         the whole app (UI, database, import, report)
app.json       Expo config
package.json   dependencies
```

## Troubleshooting

- **"Unable to resolve <package>"** - run `npx expo install <package>`.
- **"Project uses SDK X but Expo Go is SDK Y"** - run `npx expo install expo@latest` then `npx expo install --fix`.
- **Phone can't connect** - use the same Wi-Fi, or run `npx expo start --tunnel`.
- **Import fails** - pick an `.xlsx` file stored on the phone, with the headers above.

## Tech

React Native, Expo, expo-sqlite, expo-document-picker, expo-print, SheetJS (xlsx).
