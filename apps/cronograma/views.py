from django.shortcuts import render

def cronograma(request):
    return render(request, "cronograma-projetos.html")
