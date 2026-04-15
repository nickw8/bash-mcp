import { describe, expect, it } from "vitest";
import { extractCSharp } from "./csharp.js";

/** Helper to run extractor and return outline + symbol count. */
function outline(code: string) {
  const result = extractCSharp(code.split("\n"));
  return { text: result.outline.join("\n"), symbols: result.symbols };
}

describe("extractCSharp", () => {
  it("extracts using directives", () => {
    const { text } = outline(`using System;
using Microsoft.AspNetCore.Mvc;
using static MyApp.Constants;`);
    expect(text).toContain("using System;");
    expect(text).toContain("using Microsoft.AspNetCore.Mvc;");
    expect(text).toContain("using static MyApp.Constants;");
  });

  it("excludes using var (disposal pattern)", () => {
    const { text } = outline(`using System;
using var stream = File.OpenRead("test");`);
    expect(text).toContain("using System;");
    expect(text).not.toContain("using var");
  });

  it("extracts namespace declarations", () => {
    const { text, symbols } = outline(`namespace MyApp.Controllers
{
}`);
    expect(text).toContain("namespace MyApp.Controllers");
    expect(symbols).toBe(1);
  });

  it("extracts file-scoped namespaces", () => {
    const { text, symbols } = outline(`namespace MyApp.Models;

public class User { }`);
    expect(text).toContain("namespace MyApp.Models;");
    expect(symbols).toBe(2);
  });

  it("extracts class with attributes and inheritance", () => {
    const { text, symbols } = outline(`namespace MyApp.Controllers
{
    [Route("api/users")]
    [ApiController]
    public class UsersController : ControllerBase
    {
    }
}`);
    expect(text).toContain('[Route("api/users")]');
    expect(text).toContain("[ApiController]");
    expect(text).toContain("public class UsersController : ControllerBase");
    expect(symbols).toBe(2); // namespace + class
  });

  it("extracts interfaces, structs, enums, records", () => {
    const { symbols } = outline(`namespace MyApp
{
    public interface IUserService { }
    public struct Point { }
    public enum Status { Active, Inactive }
    public record UserDto(string Name);
}`);
    expect(symbols).toBe(5); // namespace + 4 types
  });

  it("extracts method signatures and strips bodies", () => {
    const { text, symbols } = outline(`public class Foo
{
    public async Task<IActionResult> GetUser(int id)
    {
        return Ok();
    }
    private void DoWork()
    {
        Console.WriteLine("hi");
    }
}`);
    expect(text).toContain("public async Task<IActionResult> GetUser(int id)");
    expect(text).toContain("private void DoWork()");
    expect(text).not.toContain("return Ok()");
    expect(text).not.toContain("Console.WriteLine");
    expect(symbols).toBe(3); // class + 2 methods
  });

  it("joins multi-line method signatures", () => {
    const { text, symbols } = outline(`public class Svc
{
    public Svc(IUserService service,
        ILogger<Svc> logger,
        IConfiguration config)
    {
    }
}`);
    expect(text).toContain("IUserService service");
    expect(text).toContain("ILogger<Svc> logger");
    expect(text).toContain("IConfiguration config");
    expect(symbols).toBe(2); // class + constructor
  });

  it("extracts properties", () => {
    const { text, symbols } = outline(`public class User
{
    public int UserId { get; set; }
    public string Name { get; set; } = null!;
    public virtual ICollection<Role> Roles { get; set; } = new List<Role>();
}`);
    expect(text).toContain("public int UserId { get; set; }");
    expect(text).toContain("public string Name { get; set; }");
    expect(text).toContain("virtual ICollection<Role> Roles");
    expect(symbols).toBe(4); // class + 3 properties
  });

  it("extracts readonly fields", () => {
    const { text } = outline(`public class Svc
{
    private readonly IUserService _userService;
    private readonly ILogger _logger;
}`);
    expect(text).toContain("private readonly IUserService _userService;");
    expect(text).toContain("private readonly ILogger _logger;");
  });

  it("does not match type keywords inside strings or method calls", () => {
    const { text } = outline(`public class Svc
{
    public void DoWork()
    {
        _logger.LogDebug("record insert into table");
        var record = GetRecord();
    }
}`);
    expect(text).not.toContain("record insert");
    expect(text).not.toContain("var record");
  });

  it("captures XML doc comments before declarations", () => {
    const { text } = outline(`public class Svc
{
    /// <summary>
    /// Gets a user by ID.
    /// </summary>
    public async Task<User> GetUser(int id)
    {
    }
}`);
    expect(text).toContain("/// <summary>");
    expect(text).toContain("/// Gets a user by ID.");
    expect(text).toContain("public async Task<User> GetUser(int id)");
  });

  it("captures header comments", () => {
    const { text } = outline(`// Copyright 2024 MyApp
// Licensed under MIT

using System;`);
    expect(text).toContain("// Copyright 2024 MyApp");
    expect(text).toContain("// Licensed under MIT");
  });
});
