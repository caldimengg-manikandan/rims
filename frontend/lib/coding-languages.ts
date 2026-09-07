/**
 * Central Language Registry for CALRIMS Coding Assessment Module (Frontend).
 * Provides language metadata, Monaco editor IDs, boilerplate starters, and templates.
 */

export interface CodingLanguage {
    id: string
    name: string
    display_name?: string
    label?: string
    extension: string
    monaco_language: string
    default_starter_code: string
    default_solution_template: string
}

export const FALLBACK_CODING_LANGUAGES: CodingLanguage[] = [
    {
        id: 'python3',
        name: 'Python 3',
        display_name: 'Python 3',
        extension: 'py',
        monaco_language: 'python',
        default_starter_code: `import sys

def solve():
    # Read from sys.stdin or input()
    pass

if __name__ == '__main__':
    solve()
`,
        default_solution_template: `import sys

def solve():
    # Working reference solution logic
    pass

if __name__ == '__main__':
    solve()
`,
    },
    {
        id: 'java21',
        name: 'Java 21',
        display_name: 'Java 21',
        extension: 'java',
        monaco_language: 'java',
        default_starter_code: `import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        // Implement solution here
    }
}
`,
        default_solution_template: `import java.util.Scanner;

public class Solution {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        // Reference solution logic
    }
}
`,
    },
    {
        id: 'cpp',
        name: 'C++ (GCC 13)',
        display_name: 'C++ (GCC 13)',
        extension: 'cpp',
        monaco_language: 'cpp',
        default_starter_code: `#include <iostream>
using namespace std;

int main() {
    // Read standard input
    return 0;
}
`,
        default_solution_template: `#include <iostream>
using namespace std;

int main() {
    // Reference solution logic
    return 0;
}
`,
    },
    {
        id: 'javascript',
        name: 'JavaScript (Node 20)',
        display_name: 'JavaScript (Node 20)',
        extension: 'js',
        monaco_language: 'javascript',
        default_starter_code: `const fs = require('fs');

function solve() {
    const input = fs.readFileSync(0, 'utf-8');
    // Implement solution
}

solve();
`,
        default_solution_template: `const fs = require('fs');

function solve() {
    const input = fs.readFileSync(0, 'utf-8');
    // Reference solution logic
}

solve();
`,
    },
    {
        id: 'typescript',
        name: 'TypeScript (Node 20)',
        display_name: 'TypeScript (Node 20)',
        extension: 'ts',
        monaco_language: 'typescript',
        default_starter_code: `import * as fs from 'fs';

function solve(): void {
    const input = fs.readFileSync(0, 'utf-8');
    // Implement solution
}

solve();
`,
        default_solution_template: `import * as fs from 'fs';

function solve(): void {
    const input = fs.readFileSync(0, 'utf-8');
    // Reference solution logic
}

solve();
`,
    },
    {
        id: 'golang',
        name: 'Go 1.22',
        display_name: 'Go 1.22',
        extension: 'go',
        monaco_language: 'go',
        default_starter_code: `package main

import "fmt"

func main() {
    // Implement solution
}
`,
        default_solution_template: `package main

import "fmt"

func main() {
    // Reference solution logic
}
`,
    },
    {
        id: 'csharp',
        name: 'C# (.NET 8)',
        display_name: 'C# (.NET 8)',
        extension: 'cs',
        monaco_language: 'csharp',
        default_starter_code: `using System;

class Program {
    static void Main(string[] args) {
        // Implement solution
    }
}
`,
        default_solution_template: `using System;

class Program {
    static void Main(string[] args) {
        // Reference solution logic
    }
}
`,
    },
    {
        id: 'rust',
        name: 'Rust 1.77',
        display_name: 'Rust 1.77',
        extension: 'rs',
        monaco_language: 'rust',
        default_starter_code: `use std::io::{self, Read};

fn main() {
    // Implement solution
}
`,
        default_solution_template: `use std::io::{self, Read};

fn main() {
    // Reference solution logic
}
`,
    },
]

export function getLanguageById(id: string, customList?: CodingLanguage[]): CodingLanguage {
    const list = customList && customList.length > 0 ? customList : FALLBACK_CODING_LANGUAGES
    const found = list.find(l => l.id === id)
    if (found) return found
    return {
        id,
        name: id,
        display_name: id,
        label: id,
        extension: 'txt',
        monaco_language: 'plaintext',
        default_starter_code: '',
        default_solution_template: '',
    }
}

export function getLanguageLabel(id: string, customList?: CodingLanguage[]): string {
    const lang = getLanguageById(id, customList)
    return lang.label || lang.display_name || lang.name || id
}
