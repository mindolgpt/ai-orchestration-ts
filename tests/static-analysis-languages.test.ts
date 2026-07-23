/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest'
import '@/static-analysis'
import { pythonPlugin } from '@/static-analysis/languages/python'
import { javaPlugin } from '@/static-analysis/languages/java'
import { goPlugin } from '@/static-analysis/languages/go'
import { rustPlugin } from '@/static-analysis/languages/rust'
import { typescriptPlugin } from '@/static-analysis/languages/typescript'

describe('typescript plugin', () => {
  it('parses classes, functions, imports and preserves rawContent', () => {
    const src = `import { Foo } from './foo'
export class Bar extends Foo implements IBaz {
  public hello(name: string): string { return name }
}
export async function greet() {}`
    const f = typescriptPlugin.parse(src, '/x/bar.ts')
    expect(f.language).toBe('typescript')
    expect(f.rawContent).toBe(src)
    expect(f.imports.map((i) => i.source)).toEqual(['./foo'])
    expect(f.classes.map((c) => c.name)).toEqual(['Bar'])
    expect(f.classes[0].extends).toBe('Foo')
    expect(f.functions.map((fn) => fn.name)).toEqual(['greet'])
  })
})

describe('python plugin', () => {
  it('parses classes with bases and functions', () => {
    const src = `from fastapi import APIRouter

class UserService(BaseService):
    def find(self, id):
        return id

async def fetch(self):
    pass`
    const f = pythonPlugin.parse(src, '/x/svc.py')
    expect(f.language).toBe('python')
    expect(f.rawContent).toBe(src)
    expect(f.imports.map((i) => i.source)).toContain('fastapi')
    expect(f.classes.map((c) => c.name)).toEqual(['UserService'])
    expect(f.classes[0].extends).toBe('BaseService')
    expect(f.functions.map((fn) => fn.name)).toEqual(['fetch'])
  })
})

describe('java plugin', () => {
  it('parses classes, interfaces and imports', () => {
    const src = `package com.x;
import com.x.Foo;
public class Bar extends Foo implements IBaz {
  public String hello(String name) { return name; }
}
interface IBaz {}`
    const f = javaPlugin.parse(src, '/x/Bar.java')
    expect(f.language).toBe('java')
    expect(f.classes.map((c) => c.name)).toEqual(expect.arrayContaining(['Bar']))
    expect(f.classes.find((c) => c.name === 'Bar')?.extends).toBe('Foo')
    expect(f.interfaces.map((i) => i.name)).toEqual(expect.arrayContaining(['IBaz']))
    expect(f.imports.map((i) => i.source)).toEqual(expect.arrayContaining(['com.x.Foo']))
  })
})

describe('go plugin', () => {
  it('parses funcs, structs and grouped imports', () => {
    const src = `package main
import (
  "net/http"
  "github.com/gin-gonic/gin"
)
type User struct {
  Name string
}
func (u *User) Hello() string { return u.Name }
func main() {}`
    const f = goPlugin.parse(src, '/x/main.go')
    expect(f.language).toBe('go')
    expect(f.imports.map((i) => i.source)).toEqual(
      expect.arrayContaining(['net/http', 'github.com/gin-gonic/gin'])
    )
    expect(f.classes.map((c) => c.name)).toContain('User')
    expect(f.functions.map((fn) => fn.name)).toEqual(expect.arrayContaining(['Hello', 'main']))
  })
})

describe('rust plugin', () => {
  it('parses structs, traits, fns and use imports', () => {
    const src = `use serde::Serialize;
#[derive(Debug, Clone)]
pub struct User { name: String }
pub trait Greet { fn hello(&self); }
pub fn build() -> User { User { name: "x".into() } }`
    const f = rustPlugin.parse(src, '/x/user.rs')
    expect(f.language).toBe('rust')
    expect(f.imports.map((i) => i.source)).toContain('serde::Serialize')
    expect(f.classes.map((c) => c.name)).toContain('User')
    expect(f.interfaces.map((i) => i.name)).toContain('Greet')
    expect(f.functions.map((fn) => fn.name)).toContain('build')
  })
})
