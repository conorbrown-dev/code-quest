using Microsoft.EntityFrameworkCore;

namespace Pathway.Api;

public sealed class ProgressDbContext(DbContextOptions<ProgressDbContext> options) : DbContext(options)
{
    public DbSet<LearnerProgress> Progress => Set<LearnerProgress>();
    public DbSet<LearnerSubmission> Submissions => Set<LearnerSubmission>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LearnerProgress>(entity =>
        {
            entity.ToTable("learner_progress");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.LessonSlug }).IsUnique();
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.LessonSlug).HasMaxLength(200);
        });
        modelBuilder.Entity<LearnerSubmission>(entity =>
        {
            entity.ToTable("learner_submissions");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => new { item.LearnerId, item.CreatedAt });
            entity.Property(item => item.LearnerId).HasMaxLength(100);
            entity.Property(item => item.LessonSlug).HasMaxLength(200);
        });
    }
}


public sealed class LearnerProgress
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string LessonSlug { get; init; }
    public DateTimeOffset CompletedAt { get; set; }
}

public sealed class LearnerSubmission
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public required string LearnerId { get; init; }
    public required string LessonSlug { get; init; }
    public string? Answer { get; init; }
    public string? Code { get; init; }
    public bool Passed { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
