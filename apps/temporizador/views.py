from django.shortcuts import render


def temporizador(request):
    return render(request, "temporizador.html")
