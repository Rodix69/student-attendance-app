# Student Attendance App

A simple mobile attendance app built with React Native (Expo) and SQLite.
Import students from Excel, mark attendance one student at a time, and print the absentees list.

## Features

- **Import from Excel** - reads `.xlsx` files with the columns `Student Name`, `Roll Number`, `Course Name`.
- **Attendance screen** - list with Sl. No., Name, Roll Number and an Absent toggle.
  - **Present** / **Absent** buttons mark the highlighted student and move to the next one. Present is the default.
  - Row colours: blue = current student, red = absent.
  - Progress bar showing how many students are marked.
- **Save attendance** - writes absentees to the database with a timestamp.
- **Absentees list** - shows the latest saved day's absentees and prints them.

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
