using System.Text.Json.Serialization;

record CircuitDefinition(
    string Title,
    string Description,
    string SafetyNote,
    string[] MeterModes,
    CircuitNode[] Nodes,
    CircuitComponent[] Components,
    CircuitMeasurement[] Measurements,
    CircuitTask Task);

record CircuitNode(string Id, string Label, double X, double Y, bool Ground = false);

record CircuitComponent(
    string Id,
    string Kind,
    string Label,
    string FromNode,
    string ToNode,
    string? Value = null);

record CircuitMeasurement(
    string MeterMode,
    string RedNode,
    string BlackNode,
    double? Value,
    string Unit,
    string Display);

record CircuitTask(
    string Instruction,
    [property: JsonIgnore] string ExpectedMeterMode,
    [property: JsonIgnore] string ExpectedRedNode,
    [property: JsonIgnore] string ExpectedBlackNode,
    Choice[] DiagnosisChoices,
    [property: JsonIgnore] string? CorrectDiagnosis = null);

record CircuitReading(double? Value, string Unit, string Display);

static class CircuitExerciseValidator
{
    public static ValidationResult Validate(
        Lesson lesson,
        string? meterMode,
        string? redProbe,
        string? blackProbe,
        string? diagnosis)
    {
        var circuit = lesson.Exercise.Circuit;
        if (circuit is null)
            return new ValidationResult(false, 0, 1, "This circuit exercise is not configured correctly.", null);

        var reading = FindReading(circuit, meterMode, redProbe, blackProbe);
        var task = circuit.Task;
        var meterCorrect = string.Equals(meterMode, task.ExpectedMeterMode, StringComparison.Ordinal);
        var redCorrect = string.Equals(redProbe, task.ExpectedRedNode, StringComparison.Ordinal);
        var blackCorrect = string.Equals(blackProbe, task.ExpectedBlackNode, StringComparison.Ordinal);
        var diagnosisCorrect = string.IsNullOrWhiteSpace(task.CorrectDiagnosis)
            || string.Equals(diagnosis, task.CorrectDiagnosis, StringComparison.Ordinal);
        var passed = meterCorrect && redCorrect && blackCorrect && diagnosisCorrect;

        string feedback;
        if (passed)
            feedback = "Correct. Your meter setup and interpretation match the circuit.";
        else if (!meterCorrect)
            feedback = "Check the meter mode first. Choose the quantity the task asks you to measure.";
        else if (!redCorrect || !blackCorrect)
            feedback = "The meter mode is right, but the probe placement is not. Re-read which two node potentials the task asks you to compare.";
        else
            feedback = "Your measurement setup is right. Use the simulated reading and circuit behavior to revisit the diagnosis.";

        return new ValidationResult(
            passed,
            passed ? 1 : 0,
            1,
            feedback,
            passed ? lesson.NextSlug : null,
            null,
            passed ? lesson.Exercise.WorkedSolution : null,
            reading);
    }

    private static CircuitReading? FindReading(
        CircuitDefinition circuit,
        string? meterMode,
        string? redProbe,
        string? blackProbe)
    {
        if (string.IsNullOrWhiteSpace(meterMode)
            || string.IsNullOrWhiteSpace(redProbe)
            || string.IsNullOrWhiteSpace(blackProbe))
            return null;

        var exact = circuit.Measurements.FirstOrDefault(item =>
            string.Equals(item.MeterMode, meterMode, StringComparison.Ordinal)
            && string.Equals(item.RedNode, redProbe, StringComparison.Ordinal)
            && string.Equals(item.BlackNode, blackProbe, StringComparison.Ordinal));
        if (exact is not null)
            return new CircuitReading(exact.Value, exact.Unit, exact.Display);

        if (string.Equals(meterMode, "V DC", StringComparison.Ordinal))
        {
            var reversed = circuit.Measurements.FirstOrDefault(item =>
                string.Equals(item.MeterMode, meterMode, StringComparison.Ordinal)
                && string.Equals(item.RedNode, blackProbe, StringComparison.Ordinal)
                && string.Equals(item.BlackNode, redProbe, StringComparison.Ordinal)
                && item.Value is not null);
            if (reversed is not null)
            {
                var value = -reversed.Value!.Value;
                return new CircuitReading(value, reversed.Unit, $"{value:0.###} {reversed.Unit}");
            }
        }

        return null;
    }
}
