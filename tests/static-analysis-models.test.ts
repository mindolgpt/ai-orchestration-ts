/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest'
import '@/static-analysis'
import { prismaModelExtractor } from '@/static-analysis/models/prisma'
import { typeormModelExtractor } from '@/static-analysis/models/typeorm'
import { mongooseModelExtractor } from '@/static-analysis/models/mongoose'
import { jpaModelExtractor } from '@/static-analysis/models/jpa'
import { sqlalchemyModelExtractor } from '@/static-analysis/models/sqlalchemy'
import { gormModelExtractor } from '@/static-analysis/models/gorm'
import { djangoOrmModelExtractor } from '@/static-analysis/models/django-orm'
import { dieselModelExtractor } from '@/static-analysis/models/diesel'
import { typescriptPlugin } from '@/static-analysis/languages/typescript'
import { pythonPlugin } from '@/static-analysis/languages/python'
import { goPlugin } from '@/static-analysis/languages/go'
import { rustPlugin } from '@/static-analysis/languages/rust'

describe('model extractors (regression: content="" bug)', () => {
  it('prisma: extracts model + fields (was empty-content bug)', () => {
    const src = `model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
}`
    const f = typescriptPlugin.parse(src, '/x/schema.ts')
    const models = prismaModelExtractor.extract([f])
    expect(models.map((m) => m.name)).toContain('User')
    const user = models.find((m) => m.name === 'User')!
    expect(user.orm).toBe('prisma')
    expect(user.fields.map((fld) => fld.name)).toEqual(
      expect.arrayContaining(['id', 'email', 'name'])
    )
    expect(user.fields.find((fld) => fld.name === 'email')?.isUnique).toBe(true)
    expect(user.fields.find((fld) => fld.name === 'id')?.isId).toBe(true)
    expect(user.relations.map((r) => r.target)).toContain('Post')
  })

  it('typeorm: extracts entity with fields + relations', () => {
    const src = `@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number
  @Column({ nullable: true }) name: string
  @Column({ unique: true }) email: string
  @OneToMany(() => Post, (post) => post.author) posts: Post[]
}`
    const f = typescriptPlugin.parse(src, '/x/user.entity.ts')
    const models = typeormModelExtractor.extract([f])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.tableName).toBe('users')
    expect(user!.fields.map((fld) => fld.name)).toEqual(
      expect.arrayContaining(['id', 'name', 'email'])
    )
    expect(user!.fields.find((fld) => fld.name === 'email')?.isUnique).toBe(true)
    expect(user!.relations.find((r) => r.target === 'Post')).toBeTruthy()
  })

  it('mongoose: extracts model + schema fields (was empty-content bug)', () => {
    const src = `const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
}))`
    const f = typescriptPlugin.parse(src, '/x/user.model.ts')
    const models = mongooseModelExtractor.extract([f])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.orm).toBe('mongoose')
    expect(user!.tableName).toBe('User')
    expect(user!.fields.map((fld) => fld.name)).toEqual(expect.arrayContaining(['name', 'email']))
  })

  it('jpa: extracts @Entity class with @Id and @Column', () => {
    const src = `@Entity
@Table(name = "users")
public class User {
  @Id private Long id;
  @Column(name = "email", unique = true) private String email;
  @Column(nullable = true) private String name;
}`
    const f = typescriptPlugin.parse(src, '/x/User.java')
    const javaFile = { ...f, language: 'java', rawContent: src }
    const models = jpaModelExtractor.extract([javaFile])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.orm).toBe('jpa')
    expect(user!.tableName).toBe('users')
    expect(user!.fields.find((fld) => fld.name === 'id')?.isId).toBe(true)
    expect(user!.fields.find((fld) => fld.name === 'email')?.isUnique).toBe(true)
  })

  it('sqlalchemy: extracts __tablename__ + Column fields', () => {
    const src = `class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True)
    name = Column(String, nullable=True)
    posts = relationship("Post")`
    const f = pythonPlugin.parse(src, '/x/models.py')
    const models = sqlalchemyModelExtractor.extract([f])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.tableName).toBe('users')
    expect(user!.fields.map((fld) => fld.name)).toEqual(
      expect.arrayContaining(['id', 'email', 'name'])
    )
    expect(user!.fields.find((fld) => fld.name === 'email')?.isUnique).toBe(true)
    expect(user!.relations.map((r) => r.target)).toContain('Post')
  })

  it('gorm: extracts struct with gorm tags', () => {
    const src = `type User struct {
    gorm.Model
    Name  string \`gorm:"size:255"\`
    Email string \`gorm:"unique"\`
}`
    const f = goPlugin.parse(src, '/x/user.go')
    const models = gormModelExtractor.extract([f])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.orm).toBe('gorm')
    expect(user!.fields.map((fld) => fld.name)).toEqual(expect.arrayContaining(['Name', 'Email']))
    expect(user!.fields.find((fld) => fld.name === 'Email')?.isUnique).toBe(true)
  })

  it('django-orm: extracts models.Model subclass with fields', () => {
    const src = `from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    age = models.IntegerField(null=True)

class Post(models.Model):
    author = models.ForeignKey('User', on_delete=models.CASCADE)`
    const f = pythonPlugin.parse(src, '/x/models.py')
    const models = djangoOrmModelExtractor.extract([f])
    const user = models.find((m) => m.name === 'User')
    expect(user).toBeTruthy()
    expect(user!.fields.map((fld) => fld.name)).toEqual(
      expect.arrayContaining(['name', 'email', 'age'])
    )
    expect(user!.fields.find((fld) => fld.name === 'email')?.isUnique).toBe(true)
    const post = models.find((m) => m.name === 'Post')
    expect(post!.relations.map((r) => r.target)).toContain('User')
  })

  it('diesel: extracts Queryable struct + table! macro', () => {
    const src = `#[derive(Queryable)]
pub struct User {
    pub id: i32,
    pub name: String,
}

table! {
    users (id) {
        id -> Int4,
        name -> Varchar,
    }
}`
    const f = rustPlugin.parse(src, '/x/models.rs')
    const models = dieselModelExtractor.extract([f])
    expect(models.map((m) => m.name)).toEqual(expect.arrayContaining(['User', 'users']))
    const user = models.find((m) => m.name === 'User')
    expect(user!.orm).toBe('diesel')
    expect(user!.fields.map((fld) => fld.name)).toEqual(expect.arrayContaining(['id', 'name']))
  })
})
